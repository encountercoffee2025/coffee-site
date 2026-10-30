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
