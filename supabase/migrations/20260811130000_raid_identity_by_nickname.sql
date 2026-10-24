-- 인물 식별 기준을 "닉네임 + 싱크로 레벨" → "닉네임"으로 단순화한다.
-- (프론트엔드 src/lib/identity.js와 반드시 같은 규칙이어야 한다. 어긋나면 3타 캡/자동 하강이
--  화면 표시와 따로 놀게 된다 — 20260811120000 마이그레이션이 고친 게 정확히 그 문제였다.)
--
-- 배경: 관리자가 대리 입력하는 멤버는 본인이 직접 기록을 올리지 않는 한 users.synchro_level이
-- 갱신되지 않는다. 싱크로까지 키에 넣으면 시즌이 지날수록 같은 사람의 기록이 갈라진다.
-- 한 길드 안에서 인게임 닉네임은 사실상 유일하므로 닉네임만으로 식별한다.
--
-- 규칙
--   · 본인 작성(is_admin_written = false): 작성자의 union_members 닉네임으로 키 생성.
--     로스터에 없으면(탈퇴 등) 'u <user_id>'로 개별 취급.
--   · 수기 기록(is_admin_written = true): 적힌 manual_nickname 그대로 키 생성.
--     같은 닉네임의 멤버가 있으면 자연히 그 멤버의 기록과 합쳐진다.
--
-- apply_real_battle_damage는 이 함수를 호출만 하므로 재정의하지 않는다. 재실행 안전.
-- p_synchro_level은 더 이상 쓰지 않지만, 호출부(apply_real_battle_damage)를 함께 바꾸지 않아도
-- 되도록 시그니처는 그대로 둔다. (인자를 빼면 이름이 같은 함수가 하나 더 생겨 오버로드 충돌)

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
begin
  if coalesce(p_is_admin_written, false) = false then
    select btrim(coalesce(um.in_game_name, ''))
      into v_name
      from union_members um
      where um.union_id = p_union_id
        and um.user_id = p_user_id
        and um.join_status = 'approved'
      limit 1;

    if not found then
      return 'u ' || coalesce(p_user_id::text, '');
    end if;

    return 'n ' || v_name;
  end if;

  return 'n ' || btrim(coalesce(p_manual_nickname, ''));
end;
$$;

grant execute on function public.raid_identity_key(uuid, boolean, uuid, text, integer) to authenticated;
