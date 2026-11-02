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
