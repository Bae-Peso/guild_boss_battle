-- 보스 이미지(URL, 1024x1024 webp 등) + 이미지 로드 실패 시 대체 텍스트.
-- 사이트 관리자 '시즌 보스전 보스 설정'에서 각 보스에 입력한다. 결산 화면에서 표시.
alter table public.global_raid_bosses
  add column if not exists image_url text,
  add column if not exists image_alt text;
