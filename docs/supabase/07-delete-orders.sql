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
