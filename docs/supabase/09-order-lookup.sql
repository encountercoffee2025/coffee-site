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
