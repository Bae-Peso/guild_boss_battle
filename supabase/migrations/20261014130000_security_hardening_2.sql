-- 보안 점검 2차(2026-10-14) 후속. 20261014120000_security_hardening.sql 다음에 적용한다.
--
-- 막는 것
--   1. 부길드장(sub_admin)이 스스로 길드장이 되거나, 길드장을 강등·추방하던 문제.
--      "Guild admins can manage members"/"... delete members" 정책이 admin 과 sub_admin 을
--      똑같이 취급해서, 화면(MembersTab.jsx: 직책 변경은 길드장만, 길드장 행은 추방·차단 불가)과
--      DB 권한이 어긋나 있었다.
--   2. 메시지 작성자가 자기 메시지의 channel_id 를 공지 채널로 옮겨, 쓰기 권한이 없는 채널에
--      글을 올리던 문제. (지휘 채팅의 union_id/room_type 도 같은 방식으로 고정한다)
--   3. init_union_raid_status 에 호출자 권한 확인이 없던 문제.
--   4. 관리자 판정에 join_status = 'approved' 가 빠진 정책 3개(채널 관리, 보스 메모 쓰기,
--      닉네임 요청 처리).
--   5. SECURITY DEFINER 함수의 search_path 미고정(Supabase 보안 린터 경고 항목).
--   6. chat_images 버킷에 파일 형식·크기 제한이 없던 문제.
--
-- 앞 마이그레이션과 같은 원칙: 앱이 원래 보내는 요청은 그대로 통과시키고, 앱이 하지 않는
-- 요청만 막는다. 트리거는 `current_user` 로 PostgREST 요청('authenticated'/'anon')만 골라
-- 검사하므로 SECURITY DEFINER 함수와 SQL Editor 경로는 영향이 없다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. union_members — 직책·길드장 행은 길드장만 손댈 수 있다
-- ─────────────────────────────────────────────────────────────────────────────
-- 화면의 실제 동작(GuildSettings.jsx / MembersTab.jsx)과 맞춘 규칙:
--   * 직책 변경(handleRoleChange, 길드장 위임) ............ 길드장만
--   * 추방·차단(handleKick / handleBanMember) ................ 관리자 둘 다, 단 길드장 행은 제외
--     - 차단은 role 을 'member' 로 되돌리므로 "차단에 따른 강등"만 예외로 허용한다
--   * 가입 승인, 닉네임 변경 승인, 가입일 수정 .............. 관리자 둘 다 (직책 무관 필드)
-- 길드장 위임 순서(owner_id 변경 → 상대 admin 지정 → 본인 member)는 마지막 단계까지
-- 호출자가 아직 admin 이므로 그대로 통과한다.
create or replace function public.guard_union_members_roles()
returns trigger
language plpgsql
-- current_user 로 요청 경로를 판별하므로 SECURITY DEFINER 로 만들면 안 된다.
set search_path = public
as $$
declare
  v_is_owner boolean;
begin
  if current_user not in ('authenticated', 'anon') or public.is_site_admin() then
    return coalesce(new, old);
  end if;

  select exists (
    select 1 from union_members m
    where m.union_id = old.union_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
      and m.join_status = 'approved'
  ) into v_is_owner;

  if v_is_owner then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    -- 본인 탈퇴는 직책과 무관하게 허용(MyPage.jsx). 남의 길드장 행은 삭제 불가.
    if old.role = 'admin' and old.user_id is distinct from auth.uid() then
      raise exception '유니온장은 추방할 수 없습니다.' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.role = 'admin'
     and (new.role is distinct from old.role or new.join_status is distinct from old.join_status) then
    raise exception '유니온장의 직책·가입 상태는 바꿀 수 없습니다.' using errcode = '42501';
  end if;

  if new.role is distinct from old.role
     and not (new.join_status = 'banned' and new.role = 'member') then
    raise exception '직책 변경은 유니온장만 할 수 있습니다.' using errcode = '42501';
  end if;

  if new.union_id is distinct from old.union_id or new.user_id is distinct from old.user_id then
    raise exception '멤버의 유니온·유저는 바꿀 수 없습니다.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_union_members_roles on public.union_members;
create trigger trg_guard_union_members_roles
  before update or delete on public.union_members
  for each row execute function public.guard_union_members_roles();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 채팅 메시지 — 보낸 채널·방·작성자는 바꿀 수 없다
-- ─────────────────────────────────────────────────────────────────────────────
-- 앱의 메시지 UPDATE 는 본문 수정(content/updated_at)과 소프트 삭제(deleted_at)뿐이다.
create or replace function public.guard_message_location()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_table_name = 'messages' then
      if new.channel_id is distinct from old.channel_id or new.user_id is distinct from old.user_id then
        raise exception '메시지의 채널·작성자는 바꿀 수 없습니다.' using errcode = '42501';
      end if;
    elsif tg_table_name = 'raid_messages' then
      if new.union_id is distinct from old.union_id
         or new.room_type is distinct from old.room_type
         or new.user_id is distinct from old.user_id then
        raise exception '메시지의 방·작성자는 바꿀 수 없습니다.' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_message_location on public.messages;
create trigger trg_guard_message_location
  before update on public.messages
  for each row execute function public.guard_message_location();

drop trigger if exists trg_guard_message_location on public.raid_messages;
create trigger trg_guard_message_location
  before update on public.raid_messages
  for each row execute function public.guard_message_location();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. init_union_raid_status — 그 길드의 관리자만
-- ─────────────────────────────────────────────────────────────────────────────
-- 호출 경로는 GuildSettings.jsx(관리자 화면) 하나다. 본문은 기존 정의 그대로이며
-- 권한 확인과 search_path 고정만 더했다.
create or replace function public.init_union_raid_status(p_union_id uuid, p_season_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
DECLARE
    max_stage INTEGER;
    b_record RECORD;
    s_level INTEGER;
    hp BIGINT;
BEGIN
    IF NOT (
        public.is_site_admin()
        OR EXISTS (
            SELECT 1 FROM union_members m
            WHERE m.union_id = p_union_id
              AND m.user_id = auth.uid()
              AND m.role = ANY (ARRAY['admin', 'sub_admin']::role_enum[])
              AND m.join_status = 'approved'
        )
    ) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- 체력 설정에서 최대 단계를 구함 (예: 3단계)
    SELECT MAX(stage_level) INTO max_stage
    FROM raid_season_hp_settings
    WHERE season_name = p_season_name;

    IF max_stage IS NULL THEN
        RAISE EXCEPTION 'Season HP settings not found';
    END IF;

    -- 1단계부터 최대 단계까지 5마리 보스 생성
    FOR s_level IN 1..max_stage LOOP
        FOR b_record IN SELECT id, boss_grade, boss_number FROM global_raid_bosses WHERE season_name = p_season_name LOOP

            -- 이미 레코드가 있는지 검사
            IF NOT EXISTS (
                SELECT 1 FROM union_raid_status
                WHERE union_id = p_union_id
                  AND global_boss_id = b_record.id
                  AND stage_level = s_level
            ) THEN
                -- 보스 등급에 따라 HP 결정
                SELECT CASE
                    WHEN b_record.boss_grade = '로드급' THEN lord_hp
                    WHEN b_record.boss_grade = '타일런트급' THEN tyrant_hp
                END INTO hp
                FROM raid_season_hp_settings
                WHERE season_name = p_season_name AND stage_level = s_level;

                INSERT INTO union_raid_status (union_id, global_boss_id, stage_level, current_hp, is_cleared)
                VALUES (p_union_id, b_record.id, s_level, hp, false);
            END IF;
        END LOOP;
    END LOOP;

    -- 5번 보스의 특수 무한 단계 (max_stage + 1) 생성 (체력 0으로 시작, 올라감)
    FOR b_record IN SELECT id FROM global_raid_bosses WHERE season_name = p_season_name AND boss_number = 5 LOOP
        IF NOT EXISTS (
            SELECT 1 FROM union_raid_status
            WHERE union_id = p_union_id
              AND global_boss_id = b_record.id
              AND stage_level = max_stage + 1
        ) THEN
            INSERT INTO union_raid_status (union_id, global_boss_id, stage_level, current_hp, is_cleared)
            VALUES (p_union_id, b_record.id, max_stage + 1, 0, false);
        END IF;
    END LOOP;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 관리자 판정에 승인 상태 조건 추가
-- ─────────────────────────────────────────────────────────────────────────────
-- 지금은 차단 시 role 을 member 로 되돌리므로 바로 악용되지는 않지만, 다른 정책들과 같은
-- 기준(승인된 관리자)으로 맞춘다. 허용 범위는 그 외에 동일하다.
drop policy if exists "Union admins can manage channels" on public.channels;
create policy "Union admins can manage channels" on public.channels
  using (
    exists (
      select 1 from public.union_members m
      where m.union_id = channels.union_id
        and m.user_id = (select auth.uid())
        and m.role = any (array['admin', 'sub_admin']::public.role_enum[])
        and m.join_status = 'approved'
    )
  );

drop policy if exists "Admins can insert union_boss_memos" on public.union_boss_memos;
create policy "Admins can insert union_boss_memos" on public.union_boss_memos
  for insert with check (
    exists (
      select 1 from public.union_members m
      where m.union_id = union_boss_memos.union_id
        and m.user_id = (select auth.uid())
        and m.role = any (array['admin', 'sub_admin']::public.role_enum[])
        and m.join_status = 'approved'
    )
  );

drop policy if exists "Admins can update union_boss_memos" on public.union_boss_memos;
create policy "Admins can update union_boss_memos" on public.union_boss_memos
  for update using (
    exists (
      select 1 from public.union_members m
      where m.union_id = union_boss_memos.union_id
        and m.user_id = (select auth.uid())
        and m.role = any (array['admin', 'sub_admin']::public.role_enum[])
        and m.join_status = 'approved'
    )
  );

drop policy if exists "Admins can update nickname requests" on public.union_nickname_requests;
create policy "Admins can update nickname requests" on public.union_nickname_requests
  for update using (
    exists (
      select 1 from public.union_members m
      where m.union_id = union_nickname_requests.union_id
        and m.user_id = (select auth.uid())
        and m.role = any (array['admin', 'sub_admin']::public.role_enum[])
        and m.join_status = 'approved'
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SECURITY DEFINER 함수 search_path 고정
-- ─────────────────────────────────────────────────────────────────────────────
-- 본문은 그대로 두고 설정만 바꾼다. 모두 public 스키마 객체만 참조한다
-- (delete_user_by_admin 은 auth.users 를 스키마 이름까지 적어서 참조).
alter function public.is_site_admin() set search_path = public;
alter function public.update_status_message(uuid, text) set search_path = public;
alter function public.update_user_ban_status(uuid, text) set search_path = public;
alter function public.update_user_uid_on_approval() set search_path = public;
alter function public.delete_user_by_admin(uuid) set search_path = public;
alter function public.update_daily_statistics() set search_path = public;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. chat_images 버킷 — 이미지 형식·크기 제한
-- ─────────────────────────────────────────────────────────────────────────────
-- 앱은 업로드 전에 WebP(미지원 브라우저는 PNG)로 재인코딩하고 긴 변 1600px 로 줄인다
-- (src/lib/imageCompress.js). 여유를 두고 일반 이미지 형식과 10MB 까지만 받는다.
update storage.buckets
   set allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg', 'image/gif'],
       file_size_limit = 10485760
 where id = 'chat_images';
