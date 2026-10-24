-- 지휘 현황판의 "실전 타수로 적용" / "계산기로 되돌리기"가 지금까지 클라이언트에서
-- union_raid_status.current_hp를 미리 읽어와 계산한 절대값으로 덮어쓰는 방식(read-modify-write)
-- 이었다. 두 유저가 거의 동시에 같은 보스에 적용하면 나중 쓰기가 먼저 쓰기를 그대로 덮어써
-- 데미지가 유실되는 동시성 버그가 있었다.
--
-- 이 마이그레이션은 "절대값 덮어쓰기" 대신 "현재 DB 값에서 차감/누적"하는 원자적 RPC 두 개를
-- 추가한다. 대상 union_raid_status 행을 SELECT ... FOR UPDATE로 잠근 뒤 같은 트랜잭션 안에서
-- 계산/갱신까지 마치므로, 동시 호출은 이 행에 대해 자동으로 직렬화되어 유실 갱신이 불가능하다.
--
-- 시즌 기준 3타 제한, is_admin_written/manual_nickname 지원, 5번 보스 무한(4단계) 누적,
-- 막타 시 오버킬 기록 방식은 현재 클라이언트 로직(ApplyRealDamageModal.jsx, BossBattleDashboard.jsx의
-- handleRevertMock)을 그대로 이식했다. (예전에 있었던 confirm_real_battle/add_mock_battle RPC는
-- 일일 초기화 기반의 옛 로직이라 fix_boss_battle_logic.sql에서 이미 DROP되어 지금은 존재하지 않는다.)
--
-- RLS가 이미 승인된 길드 멤버라면 누구나 mock_battles/union_raid_status를 직접 쓸 수 있게
-- 열려있으므로(지휘 현황판의 "실전 타수로 적용"도 관리자 전용이 아님), 아래 함수의 실행 권한도
-- 동일하게 authenticated 전체에 부여한다.

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

  -- 시즌 기준 3타(완료) 캡 체크 — is_admin_written 여부로 manual_nickname 또는 user_id 매칭
  if v_mb.is_admin_written then
    select count(*) into v_completed_count
      from mock_battles mb2
      join union_raid_status rs2 on rs2.id = mb2.boss_status_id
      join global_raid_bosses b2 on b2.id = rs2.global_boss_id
      where mb2.status = 'completed'
        and mb2.union_id = v_mb.union_id
        and b2.season_name = v_rs.season_name
        and mb2.is_admin_written = true
        and mb2.manual_nickname = v_mb.manual_nickname;
  else
    select count(*) into v_completed_count
      from mock_battles mb2
      join union_raid_status rs2 on rs2.id = mb2.boss_status_id
      join global_raid_bosses b2 on b2.id = rs2.global_boss_id
      where mb2.status = 'completed'
        and mb2.union_id = v_mb.union_id
        and b2.season_name = v_rs.season_name
        and mb2.is_admin_written = false
        and mb2.user_id = v_mb.user_id;
  end if;

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

  -- 이번 완료로 3타에 도달했으면, 동일 정체성의 나머지 대기/계산 큐 기록을 모의전 탭으로 내린다
  if v_completed_count + 1 >= 3 then
    if v_mb.is_admin_written then
      update mock_battles set is_queued = false, is_in_calc = false
        where union_id = v_mb.union_id and status = 'pending' and is_queued = true
          and is_admin_written = true and manual_nickname = v_mb.manual_nickname
          and boss_status_id in (
            select rs3.id from union_raid_status rs3
            join global_raid_bosses b3 on b3.id = rs3.global_boss_id
            where b3.season_name = v_rs.season_name
          );
    else
      update mock_battles set is_queued = false, is_in_calc = false
        where union_id = v_mb.union_id and status = 'pending' and is_queued = true
          and is_admin_written = false and user_id = v_mb.user_id
          and boss_status_id in (
            select rs3.id from union_raid_status rs3
            join global_raid_bosses b3 on b3.id = rs3.global_boss_id
            where b3.season_name = v_rs.season_name
          );
    end if;
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
