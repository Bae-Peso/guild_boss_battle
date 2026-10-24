-- 3타 캡(시즌당 1인 3타수) 판정을 화면과 동일한 "인물 병합" 기준으로 맞춘다.
--
-- 문제
--   apply_real_battle_damage는 완료 타수를 셀 때, 그리고 3타 도달 시 남은 대기/계산 기록을
--   모의전 탭으로 내릴 때 다음 두 갈래만 봤다.
--     - is_admin_written = false → user_id 일치
--     - is_admin_written = true  → manual_nickname 일치
--   그런데 실제 운영에서는 한 사람의 기록이 "본인 작성"과 "관리자 수기(대리 입력)"로 섞인다.
--   (수기 기록은 user_id에 입력한 관리자 id가 들어가고 is_admin_written = true로 저장된다.)
--   그래서 예를 들어 [수기 1타 + 본인 작성 2타]로 3타를 채운 유저는
--     · 완료 카운트가 각각 1, 2로 갈라져 v_completed_count + 1 >= 3 조건에 걸리지 않고,
--     · 남은 대기열 기록도 같은 갈래(is_admin_written 값이 같은 것)만 대상이 되어
--   3타를 다 쓴 뒤에도 모의전 기록이 지휘 현황판 대기열에 그대로 남았다.
--   같은 이유로 3타 캡(cap_reached) 자체도 새어나가 4타째가 적용될 수 있었다.
--
-- 해결
--   프론트엔드 src/lib/identity.js와 동일한 규칙으로 기록 → 인물 키를 만드는
--   raid_identity_key()를 추가하고, 카운트와 하강 대상 선정에 모두 사용한다.
--     · 본인 작성: 작성자의 union_members 행에서 닉네임 + users.synchro_level로 키 생성.
--                  로스터에 없으면(탈퇴 등) user_id로 개별 취급.
--     · 수기 기록: manual_nickname이 로스터 멤버와 "유일하게" 일치하면 그 멤버의 키로 귀속.
--                  (동명이인이 둘 이상이면 기록에 적힌 닉네임+싱크로로 개별 취급)
--
-- 이 마이그레이션은 로직만 교체하며 스키마 변경은 없다. 재실행해도 안전하다.

create or replace function public.raid_identity_key(
  p_union_id uuid,
  p_is_admin_written boolean,
  p_user_id uuid,
  p_manual_nickname text,
  p_synchro_level integer
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_name text;
  v_synchro integer;
  v_nick text;
  v_match_count integer;
begin
  -- 본인 작성 기록: 작성자의 현재 로스터 정보(닉네임 + 싱크로)로 묶는다.
  if coalesce(p_is_admin_written, false) = false then
    select btrim(coalesce(um.in_game_name, '')), u.synchro_level
      into v_name, v_synchro
      from union_members um
      left join users u on u.id = um.user_id
      where um.union_id = p_union_id
        and um.user_id = p_user_id
        and um.join_status = 'approved'
      limit 1;

    if not found then
      return 'u ' || coalesce(p_user_id::text, '');
    end if;

    return 'n ' || v_name || ' ' || coalesce(v_synchro::text, '?');
  end if;

  -- 수기 기록: 닉네임이 로스터와 유일하게 일치하면 그 멤버로 귀속시킨다.
  v_nick := btrim(coalesce(p_manual_nickname, ''));

  if v_nick <> '' then
    select count(*) into v_match_count
      from union_members um
      where um.union_id = p_union_id
        and um.join_status = 'approved'
        and btrim(coalesce(um.in_game_name, '')) = v_nick;

    if v_match_count = 1 then
      select btrim(coalesce(um.in_game_name, '')), u.synchro_level
        into v_name, v_synchro
        from union_members um
        left join users u on u.id = um.user_id
        where um.union_id = p_union_id
          and um.join_status = 'approved'
          and btrim(coalesce(um.in_game_name, '')) = v_nick
        limit 1;

      return 'n ' || v_name || ' ' || coalesce(v_synchro::text, '?');
    end if;
  end if;

  return 'n ' || v_nick || ' ' || coalesce(p_synchro_level::text, '?');
end;
$$;

grant execute on function public.raid_identity_key(uuid, boolean, uuid, text, integer) to authenticated;


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
