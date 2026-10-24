-- 보안 점검 4차 (2026-10-14). 3차(개인정보 범위) 적용 후 전체 재점검에서 나온 항목.
--
--   1. raid_messages INSERT 에 작성자 확인이 없어, 멤버가 user_id 를 남(길드장 등)으로 넣어
--      지휘 채팅에 사칭 메시지를 올릴 수 있었다. (messages 쪽은 이미 user_id = auth.uid() 확인)
--   2. update_daily_statistics() 를 비로그인(anon)도 호출할 수 있었다. 함수 안 권한 검사가
--      "auth.uid() 가 null 이면 크론 호출로 보고 통과"라서, anon 이 전체 유저·길드·신고 수를 받아갔다.
--   3. raid_identity_key() 를 anon 이 호출해 (길드 id, 유저 id) 로 인게임 닉네임을 조회할 수 있었다.
--      화면은 이 함수를 직접 부르지 않는다(apply/revert_real_battle_damage 내부 전용).
--   4. verify_union_passphrase() 를 anon 이 호출할 수 있었다(암구호 무차별 대입 경로). 가입 신청은
--      로그인 후에만 하므로 authenticated 만 남긴다.
--   5. reports / uid_change_requests INSERT 에서 status·admin_notes 를 직접 넣을 수 있었다.
--   6. audit_logs INSERT 가 actor_id 만 확인해서, 아무 길드의 감사 로그에 기록을 끼워 넣을 수 있었다.
--   7. chat_images 업로드가 로그인만 하면 누구나 가능해서, 길드와 무관한 계정이 1GB 저장 공간을
--      채울 수 있었다. 화면의 업로드는 모두 워크스페이스(승인 멤버) 안에서만 일어난다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. raid_messages INSERT — 본인 명의로만
-- ─────────────────────────────────────────────────────────────────────────────
-- 호출 경로: BossBattleChatPanel.jsx 의 insert 3곳 모두 user_id: user.id.
drop policy if exists "Users can insert raid messages" on public.raid_messages;
create policy "Users can insert raid messages" on public.raid_messages
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.union_members m
      where m.union_id = raid_messages.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
        and (
          raid_messages.room_type = 'general'
          or (
            raid_messages.room_type = 'admin'
            and m.role = any (array['admin', 'sub_admin']::role_enum[])
          )
        )
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 2~4. RPC 실행 권한
-- ─────────────────────────────────────────────────────────────────────────────
-- update_daily_statistics: 관리자 대시보드(authenticated + 함수 내부 is_site_admin 검사)와
-- pg_cron(postgres 로 실행, 권한 무관)만 쓴다.
revoke execute on function public.update_daily_statistics() from public, anon;
grant execute on function public.update_daily_statistics() to authenticated;

-- raid_identity_key: SECURITY DEFINER 함수(소유자 postgres) 안에서만 쓰이므로 외부 실행 권한이 필요 없다.
revoke execute on function public.raid_identity_key(uuid, boolean, uuid, text, integer)
  from public, anon, authenticated;

-- verify_union_passphrase: Lobby.jsx 가입 신청(로그인 상태)에서만 호출.
revoke execute on function public.verify_union_passphrase(uuid, text) from public, anon;
grant execute on function public.verify_union_passphrase(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 신고 / UID 변경 신청은 '대기' 상태로만 접수
-- ─────────────────────────────────────────────────────────────────────────────
-- ReportModal.jsx 는 status·admin_notes 를 보내지 않고(기본값 pending), MyPage.jsx 는 status: 'pending'.
drop policy if exists "Users can insert reports" on public.reports;
create policy "Users can insert reports" on public.reports
  for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'pending'
    and admin_notes is null
  );

drop policy if exists "Users can insert own uid requests" on public.uid_change_requests;
create policy "Users can insert own uid requests" on public.uid_change_requests
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and resolved_at is null
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. audit_logs INSERT — 본인 명의 + 내가 승인 멤버인 길드(또는 사이트 관리자)
-- ─────────────────────────────────────────────────────────────────────────────
-- 호출 경로(src/lib/auditLogger.js): 사이트 관리자 화면(union_id null 또는 임의 길드),
-- GuildSettings.jsx(관리자). 위임 직후 기록은 방금 일반 멤버가 된 전 길드장이 남기므로
-- 직책 대신 '승인 멤버'로 확인한다.
drop policy if exists "Authenticated users can insert audit logs" on public.audit_logs;
create policy "Authenticated users can insert audit logs" on public.audit_logs
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (
      (select public.is_site_admin())
      or union_id in (select public.my_approved_union_ids())
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. chat_images 업로드 — 승인된 길드 멤버만
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "chat_images_authenticated_insert" on storage.objects;
create policy "chat_images_authenticated_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat_images'
    and (
      exists (select 1 from public.my_approved_union_ids())
      or (select public.is_site_admin())
    )
  );
