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
