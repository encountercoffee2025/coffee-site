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
