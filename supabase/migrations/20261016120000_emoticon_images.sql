-- 채팅 이모티콘 이미지 업로드용 emoticon_images 버킷.
--
-- 지금까지 이모티콘은 외부 이미지 URL 만 등록할 수 있었다. 외부 사이트의 애니메이션 WebP 는
-- 파일 안에 반복 횟수(예: 3회)가 박혀 있어 몇 번 돌고 멈추는 문제가 있었고, 원본 사이트가
-- 파일을 지우거나 핫링크를 막으면 이모티콘이 깨졌다. 관리자 화면에서 파일을 직접 올려
-- 이 버킷에 보관한다. (업로드 시 브라우저에서 반복 횟수를 무한으로 고쳐 쓴다: src/lib/animLoop.js)
--
-- 사용처: src/pages/admin/EmoticonManagement.jsx — upload / getPublicUrl / remove

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'emoticon_images', 'emoticon_images', true,
  5242880, -- 5MB
  array['image/webp', 'image/gif', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 조회: public 버킷이라 공개 URL(/object/public/...)은 정책 없이도 누구나 읽을 수 있다.
-- 누구나 버킷 목록을 훑을 수 있는 넓은 SELECT 정책은 두지 않고, 관리자에게만 허용한다.
-- (storage API 의 remove 는 대상 행을 SELECT 로 찾은 뒤 지우므로 관리자 삭제에 필요하다)
drop policy if exists "emoticon_images_admin_select" on storage.objects;
create policy "emoticon_images_admin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'emoticon_images' and (select public.is_site_admin()));

-- 쓰기/수정/삭제: 사이트 관리자만.
drop policy if exists "emoticon_images_admin_insert" on storage.objects;
create policy "emoticon_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'emoticon_images' and (select public.is_site_admin()));

drop policy if exists "emoticon_images_admin_update" on storage.objects;
create policy "emoticon_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'emoticon_images' and (select public.is_site_admin()))
  with check (bucket_id = 'emoticon_images' and (select public.is_site_admin()));

drop policy if exists "emoticon_images_admin_delete" on storage.objects;
create policy "emoticon_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'emoticon_images' and (select public.is_site_admin()));
