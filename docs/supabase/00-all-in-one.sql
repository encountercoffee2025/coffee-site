-- 一遇 Encounter Coffee · Supabase 一次全部設定（01～09 依序合併，2026-11-16 重建）
-- 用法：新的 Supabase 專案 → SQL Editor → New query → 整段貼上 → Run。可重複執行。
-- ⚠️ 修改任何 01～09 檔案後，請重新產生這個檔案（內容 = 01～09 依序串接），
--    不然重跑舊版會把管理員的兩步驟驗證（aal2）要求蓋掉。
-- 注意：管理員必須先在 Authentication → Users 建立帳號並完成兩步驟驗證（MFA），才能登入後台。



-- ==================== 01-catalog-and-admin.sql ====================
-- 一遇 Encounter Coffee · Supabase 4-1：後台登入、雲端商品資料、圖片上傳
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。

-- 1. 管理員名單：只有列在這裡的帳號能修改商品與上傳圖片
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins can read own row" on public.admins;
create policy "admins can read own row" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.admins to authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())) $$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 2. 網站商品資料（商品、點心、烘焙批次、庫存紀錄、商店設定），所有人可讀，只有管理員可寫
create table if not exists public.site_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.site_state enable row level security;
drop policy if exists "anyone can read site state" on public.site_state;
create policy "anyone can read site state" on public.site_state
  for select to anon, authenticated using (true);
drop policy if exists "admins can insert site state" on public.site_state;
create policy "admins can insert site state" on public.site_state
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins can update site state" on public.site_state;
create policy "admins can update site state" on public.site_state
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select on public.site_state to anon, authenticated;
grant insert, update on public.site_state to authenticated;

-- 3. 圖片空間：公開讀取，只有管理員能上傳／替換／刪除，單檔上限 5MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('images', 'images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "admins can upload images" on storage.objects;
create policy "admins can upload images" on storage.objects
  for insert to authenticated with check (bucket_id = 'images' and public.is_admin());
drop policy if exists "admins can update images" on storage.objects;
create policy "admins can update images" on storage.objects
  for update to authenticated using (bucket_id = 'images' and public.is_admin());
drop policy if exists "admins can delete images" on storage.objects;
create policy "admins can delete images" on storage.objects
  for delete to authenticated using (bucket_id = 'images' and public.is_admin());

-- 4. 設定管理員帳號（需先在 Authentication → Users 建立這個帳號）
insert into public.admins (user_id)
select id from auth.users where lower(email) = 'encountercoffee2025@gmail.com'
on conflict do nothing;

-- 最後一行應顯示 admin_count = 1；若是 0，表示 Users 裡還沒有這個 Email 的帳號
select count(*) as admin_count from public.admins;

-- ==================== 02-orders.sql ====================
-- 一遇 Encounter Coffee · Supabase 4-2：雲端訂單與綠界付款
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。

-- 1. 商品資料加上版本號：下單扣庫存與後台修改同時發生時，避免互相覆蓋
alter table public.site_state add column if not exists version integer not null default 1;

-- 2. 訂單：只有伺服器（Edge Function）能建立；管理員可以讀取與更新，其他人都看不到
create table if not exists public.orders (
  id text primary key,
  token text not null,
  trade_nos text[] not null default '{}',
  status text not null,
  payment text not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_trade_nos_idx on public.orders using gin (trade_nos);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
alter table public.orders enable row level security;
drop policy if exists "admins can read orders" on public.orders;
create policy "admins can read orders" on public.orders
  for select to authenticated using (public.is_admin());
drop policy if exists "admins can update orders" on public.orders;
create policy "admins can update orders" on public.orders
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.orders from anon;
grant select, update on public.orders to authenticated;

-- 最後一行應顯示 orders_ready = true
select to_regclass('public.orders') is not null as orders_ready;

-- ==================== 03-subscriptions.sql ====================
-- 一遇 Encounter Coffee · Supabase 4-3：月費訂購（綠界信用卡定期定額）
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。

-- 訂閱：只有伺服器（Edge Function）能建立與記錄扣款；管理員可以讀取，取消要透過伺服器通知綠界
create table if not exists public.subscriptions (
  id text primary key,
  token text not null,
  trade_no text not null unique,
  status text not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_created_at_idx on public.subscriptions (created_at desc);
alter table public.subscriptions enable row level security;
drop policy if exists "admins can read subscriptions" on public.subscriptions;
create policy "admins can read subscriptions" on public.subscriptions
  for select to authenticated using (public.is_admin());
revoke all on public.subscriptions from anon;
grant select on public.subscriptions to authenticated;

-- 最後一行應顯示 subscriptions_ready = true
select to_regclass('public.subscriptions') is not null as subscriptions_ready;

-- ==================== 04-security.sql ====================
-- 一遇 Encounter Coffee · Supabase 資安強化（2026-11-02）
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。
-- 順序：先執行這個檔案 → 部署新版 Edge Functions 與網站 → 再執行 05-hide-inventory.sql

-- 1. 後台私有資料：庫存異動紀錄（ledger）與完整烘焙批次（batches）。只有管理員能讀；寫入只能透過 save_catalog。
create table if not exists public.site_private (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.site_private enable row level security;
drop policy if exists "admins can read private state" on public.site_private;
create policy "admins can read private state" on public.site_private
  for select to authenticated using (public.is_admin());
revoke all on public.site_private from anon, authenticated;
grant select on public.site_private to authenticated;

-- 先把目前的資料複製一份（05 會再用最新資料覆蓋一次）
insert into public.site_private (id, data)
select 'main', jsonb_build_object('ledger', coalesce(data->'ledger', '[]'::jsonb), 'batches', coalesce(data->'batches', '[]'::jsonb))
from public.site_state where id = 'main'
on conflict (id) do nothing;

-- 2. 一次寫入公開商品資料與私有資料（同一個交易），版本號不符就回傳 null，讓呼叫端重新載入。
create or replace function public.save_catalog(expected integer, pub jsonb, priv jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare v integer;
begin
  if not (public.is_admin() or coalesce((select auth.jwt()) ->> 'role', '') = 'service_role') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.site_state set data = pub, version = version + 1, updated_at = now()
    where id = 'main' and version = expected
    returning version into v;
  if v is null then return null; end if;
  insert into public.site_private (id, data, updated_at) values ('main', priv, now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
  return v;
end $$;
revoke all on function public.save_catalog(integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_catalog(integer, jsonb, jsonb) to authenticated, service_role;

-- 3. 管理員權限必須完成兩步驟驗證（aal2）才算數：密碼外洩也進不了後台、改不了資料。
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ==================== 05-hide-inventory.sql ====================
-- 一遇 Encounter Coffee · 把庫存紀錄與烘焙批次細節從公開資料移除（2026-11-02）
-- 用法：新版網站與 Edge Functions 部署完成「之後」再執行。Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。
-- 若公開資料還沒拆分：先把最新的 ledger／batches 存進 site_private，再把公開資料換成前台需要的最少欄位。

with cur as (
  select data from public.site_state where id = 'main' and coalesce(data->>'privateSplit', '') <> 'true'
)
insert into public.site_private (id, data, updated_at)
select 'main', jsonb_build_object('ledger', coalesce(data->'ledger', '[]'::jsonb), 'batches', coalesce(data->'batches', '[]'::jsonb)), now()
from cur
on conflict (id) do update set data = excluded.data, updated_at = now();

update public.site_state s
set data = s.data || jsonb_build_object(
      'ledger', '[]'::jsonb,
      'batches', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', b->'id', 'productId', b->'productId', 'roastDate', b->'roastDate', 'status', b->'status',
          'stockApplied', b->'stockApplied', 'durationSeconds', 600, 'packs', jsonb_build_object('200', 0), 'notes', ''))
        from jsonb_array_elements(s.data->'batches') b), '[]'::jsonb),
      'privateSplit', true),
    version = s.version + 1,
    updated_at = now()
where s.id = 'main' and coalesce(s.data->>'privateSplit', '') <> 'true';

-- 檢查：公開資料應該沒有庫存紀錄（ledger_count = 0），私有資料有
select
  (select jsonb_array_length(data->'ledger') from public.site_state where id = 'main') as public_ledger_count,
  (select jsonb_array_length(data->'ledger') from public.site_private where id = 'main') as private_ledger_count;

-- ==================== 06-order-limits.sql ====================
-- 一遇 Encounter Coffee · 只收信用卡：未付款訂單 30 分鐘自動取消、同一來源下單次數限制（2026-11-02）
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。
-- 順序：先執行這個檔案 → 再部署新版 Edge Functions（新版下單會寫入 client 欄位）

-- 1. 下單來源（IP 的雜湊值，不是 IP 本身），用來限制同一來源 10 分鐘內最多 5 筆訂單
alter table public.orders add column if not exists client text;
create index if not exists orders_client_created_idx on public.orders (client, created_at);
create index if not exists orders_unpaid_created_idx on public.orders (created_at) where payment = 'unpaid' and status = 'new';

-- 2. 排程：每 5 分鐘請伺服器取消超過 30 分鐘未付款的訂單、釋放庫存
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'release-unpaid-orders';
select cron.schedule(
  'release-unpaid-orders',
  '*/5 * * * *',
  $$ select net.http_get(
       url := 'https://ytejdngkxnebbpxedshz.supabase.co/functions/v1/checkout?sweep=1',
       headers := jsonb_build_object('apikey', 'sb_publishable_pCNZuMk-MuT4ZnLpL0fnQA_5AxJJRRI')
     ) $$
);

-- 檢查：應該看到一筆 release-unpaid-orders，schedule 為 */5 * * * *
select jobname, schedule, active from cron.job where jobname = 'release-unpaid-orders';

-- ==================== 07-delete-orders.sql ====================
-- 一遇 Encounter Coffee · 後台可刪除「已取消」的訂單（2026-11-11）
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。
-- 只有管理員能刪，而且只能刪狀態為 cancelled 的訂單；其他狀態的訂單資料庫會直接拒絕。

drop policy if exists "admins can delete cancelled orders" on public.orders;
create policy "admins can delete cancelled orders" on public.orders
  for delete to authenticated using (public.is_admin() and status = 'cancelled');
grant delete on public.orders to authenticated;

-- 最後一行應顯示 delete_orders_ready = true
select exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'orders' and policyname = 'admins can delete cancelled orders'
) as delete_orders_ready;

-- ==================== 08-tighten-grants.sql ====================
-- 一遇 Encounter Coffee · 收緊資料表權限（2026-11-15）
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行，不會改動任何資料。
--
-- 為什麼：Supabase 建表時預設把所有權限（含新增、修改、刪除、TRUNCATE）給 anon 與 authenticated，
-- 目前全靠 RLS 擋下來。這裡把權限收到網站實際用得到的最小範圍，萬一哪天 policy 寫錯也不會直接開放。
-- 伺服器（Edge Functions 的 service_role）不受影響。

-- 商品資料與頁面內容：所有人可讀；後台（登入者）可新增與修改，實際能不能寫仍由 RLS 的 is_admin() 決定
revoke all on public.site_state from anon, authenticated;
grant select on public.site_state to anon, authenticated;
grant insert, update on public.site_state to authenticated;

-- 管理員名單：只能讀自己那一列（RLS），任何人都不能從網站新增或刪除管理員
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;

-- 私有資料（庫存紀錄、完整烘焙批次）：只有管理員能讀，寫入只能透過 save_catalog
revoke all on public.site_private from anon, authenticated;
grant select on public.site_private to authenticated;

-- 訂單：外人完全碰不到；管理員可讀、更新、刪除已取消的訂單（RLS 限制）
revoke all on public.orders from anon, authenticated;
grant select, update, delete on public.orders to authenticated;

-- 訂閱：外人完全碰不到；管理員只能讀，取消要透過伺服器通知綠界
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

-- 檢查：anon 應該只剩 site_state 的 SELECT（anon_rows = 1）
select count(*) as anon_rows,
       string_agg(table_name || ':' || privilege_type, ', ') as anon_privileges
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
  and table_name in ('site_state', 'admins', 'site_private', 'orders', 'subscriptions');

-- ==================== 09-order-lookup.sql ====================
-- 一遇 Encounter Coffee · 查詢訂單的次數限制（2026-11-16）
-- 用法：Supabase → SQL Editor → New query → 整段貼上 → Run。可重複執行。
-- 順序：先執行這個檔案 → 再部署新版 Edge Functions 與網站。
--
-- 「查詢訂單」頁（訂單編號＋手機、Email 寄送連結）要限制同一來源、同一信箱的次數，防止亂猜與被拿來亂寄信。
-- 這張表只記錄「哪種動作、誰（IP 雜湊值或信箱雜湊值）、什麼時候」，不存 IP、信箱或訂單內容本身。
-- 只有伺服器（Edge Function 的 service_role）能讀寫；網站訪客與後台都碰不到。

create table if not exists public.rate_events (
  id bigint generated always as identity primary key,
  kind text not null,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists rate_events_lookup_idx on public.rate_events (kind, key, created_at);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from anon, authenticated;

-- 每天清掉一天以前的紀錄
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'clean-rate-events';
select cron.schedule('clean-rate-events', '17 3 * * *', $$ delete from public.rate_events where created_at < now() - interval '1 day' $$);

-- 檢查：rate_events_ready = true，anon_rows = 0（網站訪客沒有任何權限）
select to_regclass('public.rate_events') is not null as rate_events_ready,
       (select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_name = 'rate_events') as anon_rows;
