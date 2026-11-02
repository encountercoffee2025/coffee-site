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
