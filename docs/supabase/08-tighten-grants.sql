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
