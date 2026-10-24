-- 채팅 이미지 업로드용 스토리지 버킷 + 사이트 전역 설정(app_settings) 테이블.
-- 유저가 붙여넣기/파일로 올린 이미지는 chat_images(public) 버킷에 저장하고,
-- N일 지난 이미지는 정리 Edge Function(cleanup-chat-images)이 삭제한다.
-- N(보존일수)은 app_settings 에서 사이트 관리자가 변경한다.

-- 1. chat_images public 버킷 --------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat_images', 'chat_images', true)
on conflict (id) do nothing;

-- 2. 스토리지 정책 (storage.objects) -----------------------------------------
-- 조회는 공개(public 버킷), 업로드는 로그인 유저만. 삭제 정책은 없음 → service-role(정리 함수)만 삭제 가능.
drop policy if exists "chat_images_public_read" on storage.objects;
create policy "chat_images_public_read" on storage.objects
  for select using (bucket_id = 'chat_images');

drop policy if exists "chat_images_authenticated_insert" on storage.objects;
create policy "chat_images_authenticated_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat_images');

-- 3. 사이트 전역 설정 키-값 테이블 -------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- 로그인 유저는 읽기 가능(클라이언트가 보존일수 등을 안내에 사용할 수 있음)
drop policy if exists "app_settings_select" on public.app_settings;
create policy "app_settings_select" on public.app_settings
  for select using (auth.uid() is not null);

-- 쓰기는 사이트 관리자만
drop policy if exists "app_settings_admin_write" on public.app_settings;
create policy "app_settings_admin_write" on public.app_settings
  for all using (public.is_site_admin()) with check (public.is_site_admin());

-- 채팅 이미지 보존일수 기본값 7일
insert into public.app_settings (key, value)
values ('chat_image_retention_days', '7'::jsonb)
on conflict (key) do nothing;
