-- 보안 점검(2026-10-14)에서 확인된 권한 구멍을 막는다.
--
-- ── 배경 ────────────────────────────────────────────────────────────────────
-- 이 앱은 브라우저가 anon 키로 DB에 직접 붙으므로 RLS·SECURITY DEFINER 함수가 유일한 방어선이다.
-- 운영 DB의 pg_policies 를 직접 조회해 아래 항목이 모두 열려 있음을 확인했다.
--
--   1. union_members INSERT 가 user_id 만 확인 → 아무 길드에나 role='admin',
--      join_status='approved' 로 스스로 가입할 수 있었다. 길드 스코프 정책 전부가 이 행을
--      신분증으로 쓰므로 사실상 모든 길드 데이터가 열려 있던 셈이다.
--   2. users UPDATE 에 컬럼 제한이 없음 → 차단된 유저가 global_ban_reason 을 지워 스스로
--      차단을 풀고, uid 를 신청 절차 없이 바꿀 수 있었다.
--   3. nikkes 에 로그인 유저 전체 쓰기(FOR ALL) 정책.
--   4. user_notifications INSERT 가 WITH CHECK (true) → 누구나 아무에게나 알림(=푸시)을 보낼 수 있었다.
--   5. unions INSERT/UPDATE 로 status 를 직접 'approved' 로 만들어 개설 승인을 건너뛸 수 있었다.
--   6. union_notices 의 USING(true) SELECT 가 길드 스코프 정책을 무력화(OR 결합).
--   7. apply/revert_real_battle_damage 가 SECURITY DEFINER 인데 호출자 소속을 확인하지 않았다.
--
-- ── 설계 원칙 ───────────────────────────────────────────────────────────────
-- 앱의 정상 동작은 그대로 두고, 앱이 원래 하지 않는 요청만 막는다. 각 항목마다 이를 쓰는
-- 클라이언트 경로를 확인했다(아래 각 절 주석).
--
-- 컬럼 단위 보호는 BEFORE UPDATE 트리거로 한다. 판별은 `current_user` 로 한다:
-- PostgREST 로 들어온 요청은 'authenticated'/'anon' 역할로 실행되고, SECURITY DEFINER 함수
-- (update_user_uid_on_approval 트리거, update_user_ban_status 등) 안에서는 함수 소유자
-- 역할이 되므로 서버 측 정상 경로는 막히지 않는다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. union_members INSERT — 가입 신청은 'member' + 'pending' 으로만
-- ─────────────────────────────────────────────────────────────────────────────
-- 클라이언트 INSERT 경로 3곳:
--   * Lobby.jsx 가입 신청     : join_status 'pending', role 미지정(기본 'member')   → 허용
--   * Lobby.jsx 길드 개설   : 방금 만든 (본인 소유) 길드에 role 'admin', 'pending' → 허용
--   * admin/GuildManagement   : 사이트 관리자                                     → 허용
drop policy if exists "Users can insert own membership" on public.union_members;
drop policy if exists "Users can request to join" on public.union_members;
drop policy if exists "union_members_insert" on public.union_members;
create policy "union_members_insert" on public.union_members
  for insert to authenticated
  with check (
    (select public.is_site_admin())
    or (
      user_id = (select auth.uid())
      and coalesce(join_status, 'pending') = 'pending'
      and (
        coalesce(role, 'member') = 'member'
        -- 길드 개설자 본인의 임시 길드장 등록
        or (
          role = 'admin'
          and exists (
            select 1 from public.unions u
            where u.id = union_members.union_id
              and u.owner_id = (select auth.uid())
          )
        )
      )
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. users — 차단 사유·UID 는 본인이 바꿀 수 없다
-- ─────────────────────────────────────────────────────────────────────────────
-- 본인 수정 경로는 synchro_level(MockBattleDashboard/MockBattleUploadModal),
-- profile_image_id, username, last_login_at 뿐이다. UID 변경은 uid_change_requests 를 거쳐
-- 관리자(GuildManagement/UidRequests) 또는 승인 트리거가 반영한다.
create or replace function public.guard_users_protected_columns()
returns trigger
language plpgsql
-- current_user 로 요청 경로를 판별하므로 SECURITY DEFINER 로 만들면 안 된다(정의자 역할로 바뀐다).
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_site_admin() then
    if new.global_ban_reason is distinct from old.global_ban_reason
       or new.uid is distinct from old.uid
       or new.id is distinct from old.id then
      raise exception 'users.global_ban_reason / uid 는 관리자만 변경할 수 있습니다.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_users_protected_columns on public.users;
create trigger trg_guard_users_protected_columns
  before update on public.users
  for each row execute function public.guard_users_protected_columns();


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. nikkes — 쓰기는 사이트 관리자만 (읽기 정책은 그대로)
-- ─────────────────────────────────────────────────────────────────────────────
-- 쓰기 경로는 admin/NikkeManagement.jsx 뿐이다.
drop policy if exists "Enable all access for authenticated users" on public.nikkes;
drop policy if exists "Admins manage nikkes" on public.nikkes;
create policy "Admins manage nikkes" on public.nikkes
  for all to authenticated
  using ((select public.is_site_admin()))
  with check ((select public.is_site_admin()));


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. user_notifications INSERT — 같은 길드 안에서만
-- ─────────────────────────────────────────────────────────────────────────────
-- 삽입 경로는 멘션 알림(WorkspaceChat.jsx, BossBattleChatPanel.jsx) 뿐이며, 둘 다
-- `union_id: guild.id` 를 넣고 대상은 그 길드의 멤버 목록에서 고른다.
-- → 보내는 사람이 그 길드의 승인 멤버이고, 받는 사람도 그 길드 소속일 때만 허용.
drop policy if exists "Anyone can insert notifications" on public.user_notifications;
drop policy if exists "Anyone can insert notifications (for mentions)" on public.user_notifications;
drop policy if exists "user_notifications_insert" on public.user_notifications;
create policy "user_notifications_insert" on public.user_notifications
  for insert to authenticated
  with check (
    (select public.is_site_admin())
    or (
      exists (
        select 1 from public.union_members me
        where me.union_id = user_notifications.union_id
          and me.user_id = (select auth.uid())
          and me.join_status = 'approved'
      )
      and exists (
        select 1 from public.union_members them
        where them.union_id = user_notifications.union_id
          and them.user_id = user_notifications.user_id
      )
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. unions — 개설은 'pending' 으로만, 승인 상태는 사이트 관리자만 변경
-- ─────────────────────────────────────────────────────────────────────────────
-- Lobby.jsx 개설 신청은 status 'pending' 으로 넣는다. 상태 변경은 admin/GuildManagement.jsx 뿐.
-- 길드장 위임(GuildSettings.jsx 의 owner_id 변경)은 기존 정책대로 계속 허용한다.
drop policy if exists "Users can insert pending unions" on public.unions;
create policy "Users can insert pending unions" on public.unions
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and coalesce(status, 'pending') = 'pending'
  );

create or replace function public.guard_unions_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.status is distinct from old.status
     and not public.is_site_admin() then
    raise exception '유니온 승인 상태는 사이트 관리자만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_unions_status on public.unions;
create trigger trg_guard_unions_status
  before update on public.unions
  for each row execute function public.guard_unions_status();


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. union_notices — 길드 스코프 정책만 남긴다
-- ─────────────────────────────────────────────────────────────────────────────
-- "Anyone can read" 는 union_notices_select(승인 멤버 한정)를 OR 로 무력화하고 있었다.
-- "Admins can manage union_notices" 는 union_notices_admin_write 와 같은 범위인데
-- join_status 조건이 빠져 있어 차단·대기 중인 관리자에게도 쓰기를 열어줬다.
-- 읽기 경로(NoticeBanner.jsx, GuildSettings.jsx)는 모두 본인의 승인 길드만 조회한다.
drop policy if exists "Anyone can read union_notices" on public.union_notices;
drop policy if exists "Admins can manage union_notices" on public.union_notices;


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. 실전 대미지 적용/되돌리기 RPC — 호출자 소속 확인
-- ─────────────────────────────────────────────────────────────────────────────
-- 본문은 20260811120000(apply), 20260714120000(revert) 의 최신 정의 그대로이며,
-- 대상 모의전을 읽은 직후 권한 확인 블록 하나만 추가했다.
-- 앱에서는 같은 길드 승인 멤버만 호출하므로(ApplyRealDamageModal / BossBattleDashboard) 동작 변화 없음.

create or replace function public.apply_real_battle_damage(
  p_mock_battle_id uuid,
  p_real_damage bigint,
  p_is_last_hit boolean
)
returns table (
  code text,
  current_hp bigint,
  is_cleared boolean,
  real_damage bigint,
  is_last_hit boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mb record;
  v_rs record;
  v_max_stage integer;
  v_is_infinite boolean;
  v_identity text;
  v_completed_count integer;
  v_new_hp bigint;
  v_cleared boolean;
  v_real_damage_recorded bigint;
  v_last_hit boolean;
begin
  select * into v_mb from mock_battles where id = p_mock_battle_id for update;
  if not found then
    return query select 'not_found'::text, null::bigint, null::boolean, null::bigint, null::boolean;
    return;
  end if;

  -- 호출자 권한 확인: 이 모의전이 속한 길드의 승인 멤버(또는 사이트 관리자)만 호출할 수 있다.
  -- SECURITY DEFINER 라 RLS 를 우회하므로, mock_battles 정책과 같은 경계를 여기서 직접 건다.
  if not (
    public.is_site_admin()
    or exists (
      select 1 from union_members m
      where m.union_id = v_mb.union_id
        and m.user_id = auth.uid()
        and m.join_status = 'approved'
    )
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_mb.status = 'completed' then
    return query select 'already_completed'::text, null::bigint, null::boolean, null::bigint, null::boolean;
    return;
  end if;

  select rs.id, rs.current_hp, rs.is_cleared, rs.stage_level, rs.global_boss_id,
         b.boss_number, b.season_name
    into v_rs
    from union_raid_status rs
    join global_raid_bosses b on b.id = rs.global_boss_id
    where rs.id = v_mb.boss_status_id
    for update of rs;

  select max(stage_level) into v_max_stage
    from raid_season_hp_settings
    where season_name = v_rs.season_name;
  v_is_infinite := (v_rs.boss_number = 5 and v_rs.stage_level = v_max_stage + 1);

  if v_rs.is_cleared and not v_is_infinite then
    return query select 'boss_cleared'::text, v_rs.current_hp, v_rs.is_cleared, null::bigint, null::boolean;
    return;
  end if;

  -- 시즌 기준 3타(완료) 캡 체크 — 본인 작성/관리자 수기를 하나의 인물로 합쳐서 센다.
  v_identity := raid_identity_key(
    v_mb.union_id, v_mb.is_admin_written, v_mb.user_id, v_mb.manual_nickname, v_mb.synchro_level
  );

  select count(*) into v_completed_count
    from mock_battles mb2
    join union_raid_status rs2 on rs2.id = mb2.boss_status_id
    join global_raid_bosses b2 on b2.id = rs2.global_boss_id
    where mb2.status = 'completed'
      and mb2.union_id = v_mb.union_id
      and b2.season_name = v_rs.season_name
      and raid_identity_key(
            mb2.union_id, mb2.is_admin_written, mb2.user_id, mb2.manual_nickname, mb2.synchro_level
          ) = v_identity;

  if v_completed_count >= 3 then
    update mock_battles set is_in_calc = false where id = p_mock_battle_id;
    return query select 'cap_reached'::text, v_rs.current_hp, v_rs.is_cleared, null::bigint, null::boolean;
    return;
  end if;

  if not v_is_infinite and not p_is_last_hit and p_real_damage >= v_rs.current_hp then
    return query select 'overkill_without_last_hit'::text, v_rs.current_hp, v_rs.is_cleared, null::bigint, null::boolean;
    return;
  end if;

  v_last_hit := (not v_is_infinite) and p_is_last_hit;

  if v_is_infinite then
    v_real_damage_recorded := p_real_damage;
    v_new_hp := v_rs.current_hp + p_real_damage;
    v_cleared := v_rs.is_cleared;
  elsif v_last_hit then
    v_real_damage_recorded := greatest(0, v_rs.current_hp);
    v_new_hp := v_rs.current_hp - v_mb.expected_damage;
    v_cleared := true;
  else
    v_real_damage_recorded := p_real_damage;
    v_new_hp := v_rs.current_hp - p_real_damage;
    v_cleared := v_rs.is_cleared;
  end if;

  update union_raid_status set current_hp = v_new_hp, is_cleared = v_cleared where id = v_rs.id;

  update mock_battles
    set status = 'completed', real_damage = v_real_damage_recorded, is_last_hit = v_last_hit, completed_at = now()
    where id = p_mock_battle_id;

  -- 이번 완료로 3타에 도달했으면 = 그 인물의 길드 보스전 종료.
  -- 같은 인물의 남은 대기/계산 기록을 모의전 탭으로 내려 현황판에서 치운다.
  if v_completed_count + 1 >= 3 then
    update mock_battles mb3
      set is_queued = false, is_in_calc = false
      where mb3.union_id = v_mb.union_id
        and mb3.status = 'pending'
        and mb3.is_queued = true
        and mb3.boss_status_id in (
          select rs3.id from union_raid_status rs3
          join global_raid_bosses b3 on b3.id = rs3.global_boss_id
          where rs3.union_id = v_mb.union_id
            and b3.season_name = v_rs.season_name
        )
        and raid_identity_key(
              mb3.union_id, mb3.is_admin_written, mb3.user_id, mb3.manual_nickname, mb3.synchro_level
            ) = v_identity;
  end if;

  return query select 'applied'::text, v_new_hp, v_cleared, v_real_damage_recorded, v_last_hit;
end;
$$;

grant execute on function public.apply_real_battle_damage(uuid, bigint, boolean) to authenticated;

create or replace function public.revert_real_battle_damage(
  p_mock_battle_id uuid
)
returns table (
  code text,
  current_hp bigint,
  is_cleared boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mb record;
  v_rs record;
  v_max_stage integer;
  v_is_infinite boolean;
  v_restore bigint;
  v_new_hp bigint;
  v_cleared boolean;
begin
  select * into v_mb from mock_battles where id = p_mock_battle_id for update;
  if not found then
    return query select 'not_found'::text, null::bigint, null::boolean;
    return;
  end if;

  -- 호출자 권한 확인: 이 모의전이 속한 길드의 승인 멤버(또는 사이트 관리자)만 호출할 수 있다.
  -- SECURITY DEFINER 라 RLS 를 우회하므로, mock_battles 정책과 같은 경계를 여기서 직접 건다.
  if not (
    public.is_site_admin()
    or exists (
      select 1 from union_members m
      where m.union_id = v_mb.union_id
        and m.user_id = auth.uid()
        and m.join_status = 'approved'
    )
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_mb.status <> 'completed' then
    return query select 'not_completed'::text, null::bigint, null::boolean;
    return;
  end if;

  select rs.id, rs.current_hp, rs.is_cleared, rs.stage_level, rs.global_boss_id,
         b.boss_number, b.season_name
    into v_rs
    from union_raid_status rs
    join global_raid_bosses b on b.id = rs.global_boss_id
    where rs.id = v_mb.boss_status_id
    for update of rs;

  select max(stage_level) into v_max_stage
    from raid_season_hp_settings
    where season_name = v_rs.season_name;
  v_is_infinite := (v_rs.boss_number = 5 and v_rs.stage_level = v_max_stage + 1);

  -- 막타로 기록된 경우 실제로 차감된 양은 expected_damage였다(real_damage는 오버킬 보정값이라
  -- 되돌릴 때 그대로 쓰면 안 됨). ApplyRealDamageModal의 계산과 반대 방향으로 정확히 되돌린다.
  v_restore := case when v_mb.is_last_hit then v_mb.expected_damage else v_mb.real_damage end;

  if v_is_infinite then
    v_new_hp := v_rs.current_hp - v_restore;
    v_cleared := v_rs.is_cleared;
  else
    v_new_hp := v_rs.current_hp + v_restore;
    v_cleared := case when v_new_hp > 0 then false else v_rs.is_cleared end;
  end if;

  update union_raid_status set current_hp = v_new_hp, is_cleared = v_cleared where id = v_rs.id;

  update mock_battles
    set status = 'pending', is_in_calc = true, real_damage = null, is_last_hit = false, completed_at = null
    where id = p_mock_battle_id;

  return query select 'reverted'::text, v_new_hp, v_cleared;
end;
$$;

grant execute on function public.revert_real_battle_damage(uuid) to authenticated;
