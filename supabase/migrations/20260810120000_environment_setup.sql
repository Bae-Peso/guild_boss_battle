-- 덤프가 잡지 못하는 "public 스키마 밖" 환경 설정 일체.
--
-- 배경: schema.sql 은 `pg_dump --schema=public` 산출물이라 아래 3가지가 빠진다.
--   1) Storage 버킷        (storage 스키마)
--   2) Realtime publication (pg_publication — 클러스터 전역 객체)
--   3) pg_cron 스케줄       (cron 스키마)
-- 이 설정들은 그동안 리포지토리 루트의 일회성 SQL 파일에만 남아 있었고, 그 파일들을 정리하면서
-- 유일한 기록이 사라질 위험이 있어 여기 한 곳으로 통합한다.
-- 전부 재실행 안전(idempotent)하게 작성했다.
--
-- ⚠️ 적용 전 확인: 이 파일 맨 아래 "부록 A"의 조회 쿼리로 현재 운영 DB 상태를 먼저 확인하고,
--    아래 목록과 차이가 있으면 실제 상태에 맞춰 조정할 것. (특히 §2 의 publication 멤버십)


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Storage 버킷
-- ─────────────────────────────────────────────────────────────────────────────
-- chat_images 는 20260703120000_chat_images.sql 에 이미 정의되어 있다. 여기서는
-- 정의가 어디에도 없던 nikke_images 만 추가한다. (없으면 관리자 니케 이미지 업로드가 동작하지 않음)
--
-- 사용처: src/pages/admin/NikkeManagement.jsx — upload / getPublicUrl / remove
-- getPublicUrl 을 쓰므로 public 버킷이어야 한다.

insert into storage.buckets (id, name, public)
values ('nikke_images', 'nikke_images', true)
on conflict (id) do nothing;

-- 조회: 공개 (public 버킷 + 앱이 익명 URL 로 직접 참조)
drop policy if exists "nikke_images_public_read" on storage.objects;
create policy "nikke_images_public_read" on storage.objects
  for select using (bucket_id = 'nikke_images');

-- 쓰기/삭제: 사이트 관리자만. (chat_images 와 달리 관리자 전용 자산이라 일반 유저 업로드를 막는다)
drop policy if exists "nikke_images_admin_insert" on storage.objects;
create policy "nikke_images_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'nikke_images' and public.is_site_admin());

drop policy if exists "nikke_images_admin_update" on storage.objects;
create policy "nikke_images_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'nikke_images' and public.is_site_admin())
  with check (bucket_id = 'nikke_images' and public.is_site_admin());

drop policy if exists "nikke_images_admin_delete" on storage.objects;
create policy "nikke_images_admin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'nikke_images' and public.is_site_admin());


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Realtime publication
-- ─────────────────────────────────────────────────────────────────────────────
-- 앱이 postgres_changes 로 구독하는 테이블 11개. (src 전체에서 `table: '...'` 를 추출한 목록)
-- publication 에 없으면 해당 화면의 실시간 갱신이 조용히 동작하지 않는다.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
  tables text[] := array[
    'messages',                 -- 일반 채팅
    'channels',                 -- 채널 생성/수정/삭제
    'union_members',            -- 멤버 승인/추방/역할 변경
    'union_nickname_requests',  -- 닉네임 변경 요청 배지
    'raid_messages',            -- 지휘 채팅
    'user_notifications',       -- 멘션 토스트/푸시
    'users',                    -- 프로필 이미지·싱크로 레벨 반영
    'mock_battles',             -- 지휘 현황판 타수
    'union_raid_status',        -- 보스 HP
    'recommended_squads',       -- 추천 스쿼드
    'union_boss_memos'          -- 보스 메모
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- REPLICA IDENTITY FULL — UPDATE/DELETE 이벤트에 변경 전 행까지 담아,
-- 서버측 filter 가 DELETE 에서도 매칭되도록 한다.
-- ※ 아래 5개는 현재 운영 DB 상태와 동일하다(schema.sql 확인). 나머지 6개 테이블은
--   기본(primary key) 그대로이며, 그래서 GuildBossBattleStatus.jsx 등은 filter 없이 전체 구독 후
--   클라이언트에서 판별하는 우회를 쓴다. 동작 변경을 피하려고 현 상태를 그대로 기록만 한다.
alter table public.messages      replica identity full;
alter table public.channels      replica identity full;
alter table public.raid_messages replica identity full;
alter table public.mock_battles  replica identity full;
alter table public.users         replica identity full;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pg_cron 스케줄
-- ─────────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3-1. 일일 통계 스냅샷 (매일 23:59)
--      update_daily_statistics() 는 auth.uid() 가 null 이면(=크론 실행) 권한 검사를 건너뛴다.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-snapshot-job') then
    perform cron.unschedule('daily-snapshot-job');
  end if;
end $$;

select cron.schedule(
  'daily-snapshot-job',
  '59 23 * * *',
  $job$ select public.update_daily_statistics(); $job$
);

-- 3-2. 채팅 이미지 자동 정리 (매일 04:10 UTC)
--      Storage 파일 회수는 Storage API 가 필요하므로 pg_net 으로 Edge Function 을 호출한다.
--
--      ⚠️ 이 블록은 시크릿이 필요해 그대로 실행되지 않는다. 아래 두 값을 치환한 뒤 수동 실행할 것.
--         <PROJECT_REF>     : Supabase 프로젝트 ref
--         <CLEANUP_SECRET>  : supabase secrets set CLEANUP_SECRET=... 로 설정한 값
--      시크릿을 저장소에 커밋하지 않기 위해 의도적으로 주석 처리해 둔다.
--
-- do $$
-- begin
--   if exists (select 1 from cron.job where jobname = 'cleanup-chat-images-daily') then
--     perform cron.unschedule('cleanup-chat-images-daily');
--   end if;
-- end $$;
--
-- select cron.schedule(
--   'cleanup-chat-images-daily',
--   '10 4 * * *',
--   $job$
--   select net.http_post(
--     url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-chat-images',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-cleanup-secret', '<CLEANUP_SECRET>'
--     ),
--     body    := '{}'::jsonb
--   );
--   $job$
-- );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 신규 환경 부트스트랩 메모 (실행 대상 아님)
-- ─────────────────────────────────────────────────────────────────────────────
-- 새 프로젝트를 처음 세울 때는 최초 사이트 관리자를 수동으로 지정해야 한다.
-- (기존 promote_admin.sql 이 하던 일. 계정 이메일이 하드코딩돼 있어 그대로 옮기지 않는다.)
--
--   insert into public.site_admins (user_id, is_active, grant_reason)
--   select id, true, '최초 사이트 소유자' from auth.users where email = '<아이디>@nikke.local';
--
-- 그 밖에 코드/덤프 어디에도 없어 Dashboard 에서 별도로 설정해야 하는 것:
--   - Edge Function 시크릿 : VAPID_KEYS_JWK, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET, CLEANUP_SECRET
--   - Database Webhook     : user_notifications INSERT → send-push (헤더 x-push-secret)


-- ─────────────────────────────────────────────────────────────────────────────
-- 부록 A. 현재 상태 확인 쿼리 (적용 전 비교용)
-- ─────────────────────────────────────────────────────────────────────────────
--   -- Storage 버킷
--   select id, public from storage.buckets order by id;
--
--   -- Realtime publication 멤버십
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public' order by tablename;
--
--   -- REPLICA IDENTITY (f = full)
--   select relname, relreplident from pg_class
--    where relnamespace = 'public'::regnamespace and relkind = 'r' and relreplident = 'f'
--    order by relname;
--
--   -- 등록된 크론 잡
--   select jobname, schedule, active from cron.job order by jobname;
