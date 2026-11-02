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
