-- =============================================================================
-- 길드 보스전 지휘소 — Supabase 초기 설치 SQL
--
-- 새 Supabase 프로젝트의 SQL Editor에 이 파일 전체를 붙여넣고 한 번 실행하면
-- DB 구성(테이블, RLS, 함수, 트리거, Storage, Realtime, 정기 작업)이 끝난다.
--
-- 이 파일은 schema.sql 스냅샷과 supabase/migrations/ 를 모두 적용한 최종 상태를
-- 하나로 합친 것이다. 변경 이력은 supabase/migrations/ 에 남아 있다.
-- =============================================================================

-- 0. 확장 기능 (정기 작업용)
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- =============================================================================
-- 1. public 스키마: 테이블, 타입, 함수, RLS 정책, 인덱스, 트리거
-- =============================================================================
--
-- PostgreSQL database dump
--


-- Dumped from database version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
-- Dumped by pg_dump version 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

-- (public 스키마는 Supabase에 이미 존재)


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--




--
-- Name: action_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.action_type_enum AS ENUM (
    'join',
    'leave',
    'ban',
    'role_change',
    'admin_transfer',
    'member_join',
    'member_kick',
    'member_ban',
    'union_created',
    'union_deleted',
    'uid_approved',
    'uid_rejected',
    'user_banned',
    'member_unban',
    'passphrase_update'
);


--
-- Name: boss_grade_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.boss_grade_enum AS ENUM (
    '로드급',
    '타일런트급'
);


--
-- Name: channel_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.channel_type_enum AS ENUM (
    'general',
    'notice',
    'admin_only',
    'raid_order'
);


--
-- Name: class_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.class_type_enum AS ENUM (
    '공격형',
    '지원형',
    '방어형'
);


--
-- Name: difficulty_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.difficulty_enum AS ENUM (
    'normal',
    'hard'
);


--
-- Name: element_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.element_enum AS ENUM (
    '작열',
    '수냉',
    '풍압',
    '전격',
    '철갑'
);


--
-- Name: grade_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.grade_enum AS ENUM (
    'R',
    'SR',
    'SSR'
);


--
-- Name: join_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.join_status_enum AS ENUM (
    'pending',
    'approved',
    'banned',
    'rejected'
);


--
-- Name: manufacturer_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.manufacturer_enum AS ENUM (
    '엘리시온',
    '미실리스',
    '테트라',
    '필그림',
    '앱노멀'
);


--
-- Name: mock_battle_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.mock_battle_status_enum AS ENUM (
    'pending',
    'completed'
);


--
-- Name: notification_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type_enum AS ENUM (
    'mention',
    'notice',
    'system'
);


--
-- Name: report_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.report_status_enum AS ENUM (
    'pending',
    'approved',
    'completed',
    'rejected'
);


--
-- Name: role_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.role_enum AS ENUM (
    'member',
    'sub_admin',
    'admin'
);


--
-- Name: server_region_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.server_region_enum AS ENUM (
    'KR',
    'JP',
    'Global',
    'NA',
    'SEA'
);


--
-- Name: union_status_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.union_status_enum AS ENUM (
    'pending',
    'approved',
    'banned'
);


--
-- Name: weapon_type_enum; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.weapon_type_enum AS ENUM (
    'SR',
    'SMG',
    'AR',
    'RL',
    'MG',
    'SG'
);


--
-- Name: apply_real_battle_damage(uuid, bigint, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_real_battle_damage(p_mock_battle_id uuid, p_real_damage bigint, p_is_last_hit boolean) RETURNS TABLE(code text, current_hp bigint, is_cleared boolean, real_damage bigint, is_last_hit boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: delete_user_by_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_user_by_admin(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- 최고 관리자 권한 확인
  IF NOT public.is_site_admin() THEN
    RAISE EXCEPTION 'Access denied: Requires site admin privileges';
  END IF;

  -- 안전 장치: 최고 관리자 본인(id=...)은 삭제 불가 로직은 넣지 않았으나, 자기 자신을 삭제할 수도 있음.
  -- auth.users에서 삭제하면 외래키(ON DELETE CASCADE) 설정에 의해 모든 프로필 및 소속 정보가 자동으로 날아감.
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;


--
-- Name: get_nikke_usage_ranking(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_nikke_usage_ranking(p_boss_name text DEFAULT NULL::text, p_element text DEFAULT NULL::text, p_season_count integer DEFAULT 3, p_min_decks integer DEFAULT 30) RETURNS TABLE(nikke_id integer, score numeric, uses bigint, scope text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
with params as (
  select least(greatest(coalesce(p_season_count, 3), 1), 10) as n,
         greatest(coalesce(p_min_decks, 30), 0) as min_decks
),
-- 완료 타수가 하나라도 있는 시즌만 최신순으로 N개. 이제 막 시작해 기록이 없는 시즌이
-- 가장 큰 가중치를 가져가 버리는 것을 막는다.
recent as (
  select s.name as season_name,
         row_number() over (order by s.start_date desc) as rn
  from public.raid_seasons s
  where exists (
    select 1
    from public.global_raid_bosses b
    join public.union_raid_status rs on rs.global_boss_id = b.id
    join public.mock_battles mb on mb.boss_status_id = rs.id and mb.status = 'completed'
    where b.season_name = s.name
  )
  order by s.start_date desc
  limit (select n from params)
),
weighted as (
  select r.season_name,
         ((select n from params) - r.rn + 1)::numeric as weight
  from recent r
),
decks as (
  select mb.id,
         w.season_name,
         w.weight,
         case
           when p_boss_name is not null and b.name = p_boss_name then 1
           when p_element is not null and b.element::text = p_element then 2
           else 3
         end as tier,
         mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id,
         mb.slot_4_nikke_id, mb.slot_5_nikke_id
  from public.mock_battles mb
  join public.union_raid_status rs on rs.id = mb.boss_status_id
  join public.global_raid_bosses b on b.id = rs.global_boss_id
  join weighted w on w.season_name = b.season_name
  where mb.status = 'completed'
),
tier_counts as (
  select t.tier,
         (select count(*) from decks d where d.tier <= t.tier) as decks_at_or_below
  from generate_series(1, 3) as t(tier)
),
-- 표본이 p_min_decks 이상인 가장 좁은 범위. 어느 범위도 못 채우면 가장 넓은 3.
-- greatest(..., 1) 이 필요한 이유: p_min_decks 가 0 이면 덱이 하나도 없는 tier 1 도
-- 조건을 만족해 버려서 빈 결과가 나온다. 범위는 최소 1덱은 있어야 고를 수 있다.
chosen as (
  select coalesce(
    (select min(tc.tier)
       from tier_counts tc
      where tc.decks_at_or_below >= greatest((select min_decks from params), 1)),
    3
  ) as tier
),
sel as (
  select d.*
  from decks d
  cross join chosen c
  where d.tier <= c.tier
),
totals as (
  select s.season_name, s.weight, count(*)::numeric as total
  from sel s
  group by s.season_name, s.weight
),
slots as (
  select s.id, s.season_name, v.nid
  from sel s
  cross join lateral (values
    (s.slot_1_nikke_id), (s.slot_2_nikke_id), (s.slot_3_nikke_id),
    (s.slot_4_nikke_id), (s.slot_5_nikke_id)
  ) as v(nid)
  where v.nid is not null
),
per_season as (
  select sl.season_name, sl.nid, count(distinct sl.id)::numeric as cnt
  from slots sl
  group by sl.season_name, sl.nid
)
select ps.nid::integer as nikke_id,
       round(sum(t.weight * ps.cnt / t.total), 6) as score,
       sum(ps.cnt)::bigint as uses,
       (select case c.tier when 1 then 'boss' when 2 then 'element' else 'all' end
          from chosen c) as scope
from per_season ps
join totals t on t.season_name = ps.season_name
group by ps.nid
order by score desc, uses desc, nikke_id;
$$;


--
-- Name: FUNCTION get_nikke_usage_ranking(p_boss_name text, p_element text, p_season_count integer, p_min_decks integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_nikke_usage_ranking(p_boss_name text, p_element text, p_season_count integer, p_min_decks integer) IS '최근 시즌의 완료 모의전 덱을 집계해 니케별 사용 점수를 돌려준다. 니케 선택 모달 정렬용.';


--
-- Name: guard_message_location(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_message_location() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: guard_union_members_roles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_union_members_roles() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: guard_unions_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_unions_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: guard_users_protected_columns(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_users_protected_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
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


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into public.users (id, username)
  values (
    new.id,
    -- new.email에서 '@'를 기준으로 자른 뒤, 첫 번째(1) 조각을 가져옵니다.
    -- 만약 이메일이 null이라면 'user_아이디일부' 형태로 대체합니다.
    coalesce(
      split_part(new.email, '@', 1), 
      'user_' || substr(new.id::text, 1, 8)
    )
  );
  return new;
end;
$$;


--
-- Name: init_union_raid_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.init_union_raid_status(p_union_id uuid, p_season_name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: is_raid_message_locked(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_raid_message_locked(p_raid_message_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select public.is_raid_season_locked(rm.union_id, rm.season_name)
    from public.raid_messages rm
    where rm.id = p_raid_message_id
  ), false);
$$;


--
-- Name: is_raid_season_locked(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_raid_season_locked(p_union_id uuid, p_season_name text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce((
    select s.is_locked
    from public.union_raid_season_settings s
    where s.union_id = p_union_id
      and s.season_name = p_season_name
  ), false);
$$;


--
-- Name: is_site_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_site_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists(select 1 from public.site_admins where user_id = auth.uid() and is_active = true);
$$;


--
-- Name: is_uid_taken(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_uid_taken(p_uid text, p_exclude_user uuid DEFAULT NULL::uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from users
    where uid = p_uid
      and id is distinct from coalesce(p_exclude_user, auth.uid())
  );
$$;


--
-- Name: my_approved_union_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_approved_union_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select union_id from union_members
  where user_id = auth.uid() and join_status = 'approved';
$$;


--
-- Name: my_managed_union_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_managed_union_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select union_id from union_members
  where user_id = auth.uid()
    and join_status = 'approved'
    and role = any (array['admin', 'sub_admin']::role_enum[]);
$$;


--
-- Name: raid_identity_key(uuid, boolean, uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.raid_identity_key(p_union_id uuid, p_is_admin_written boolean, p_user_id uuid, p_manual_nickname text, p_synchro_level integer) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: revert_real_battle_damage(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revert_real_battle_damage(p_mock_battle_id uuid) RETURNS TABLE(code text, current_hp bigint, is_cleared boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: set_union_raid_status_cleared_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_union_raid_status_cleared_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.is_cleared and not coalesce(old.is_cleared, false) then
    new.cleared_at := now();
  elsif not new.is_cleared and coalesce(old.is_cleared, false) then
    new.cleared_at := null;
  end if;
  return new;
end;
$$;


--
-- Name: update_daily_statistics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_daily_statistics() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_total_users INT;
  v_active_users INT;
  v_approved_unions INT;
  v_pending_unions INT;
  v_banned_unions INT;
  v_pending_reports INT;
BEGIN
  -- 최고 관리자 권한 확인 (사용자가 직접 호출한 경우에만 검사, 크론이 백그라운드에서 돌릴 땐 auth.uid()가 null이므로 통과)
  IF auth.uid() IS NOT NULL AND NOT public.is_site_admin() THEN
    RAISE EXCEPTION 'Access denied: Requires site admin privileges';
  END IF;

  -- 지표 계산
  SELECT count(*) INTO v_total_users FROM public.users;
  SELECT count(DISTINCT user_id) INTO v_active_users FROM public.union_members WHERE join_status = 'approved';
  SELECT count(*) INTO v_approved_unions FROM public.unions WHERE status = 'approved';
  SELECT count(*) INTO v_pending_unions FROM public.unions WHERE status = 'pending';
  SELECT count(*) INTO v_banned_unions FROM public.unions WHERE status = 'banned';
  SELECT count(*) INTO v_pending_reports FROM public.reports WHERE status = 'pending';
  
  -- 오늘 날짜 데이터 UPSERT
  INSERT INTO public.daily_statistics (
    date, total_users, active_users, approved_unions, pending_unions, banned_unions, pending_reports, last_updated
  ) VALUES (
    CURRENT_DATE, v_total_users, v_active_users, v_approved_unions, v_pending_unions, v_banned_unions, v_pending_reports, NOW()
  )
  ON CONFLICT (date) DO UPDATE SET
    total_users = EXCLUDED.total_users,
    active_users = EXCLUDED.active_users,
    approved_unions = EXCLUDED.approved_unions,
    pending_unions = EXCLUDED.pending_unions,
    banned_unions = EXCLUDED.banned_unions,
    pending_reports = EXCLUDED.pending_reports,
    last_updated = EXCLUDED.last_updated;
    
  RETURN json_build_object(
    'total_users', v_total_users,
    'active_users', v_active_users,
    'approved_unions', v_approved_unions,
    'pending_unions', v_pending_unions,
    'banned_unions', v_banned_unions,
    'pending_reports', v_pending_reports
  );
END;
$$;


--
-- Name: update_status_message(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_status_message(p_union_id uuid, p_message text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE union_members
  SET status_message = p_message
  WHERE union_id = p_union_id AND user_id = auth.uid();
END;
$$;


--
-- Name: update_user_ban_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_ban_status(p_target_user_id uuid, p_reason text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- 1. 호출자가 최고 관리자인지 확인 (site_admins 테이블 참조)
  SELECT is_active INTO v_is_admin FROM site_admins WHERE user_id = auth.uid();
  
  IF v_is_admin IS NULL OR NOT v_is_admin THEN
    RAISE EXCEPTION 'Only site admins can ban or unban users.';
  END IF;

  -- 2. 타겟 유저 업데이트
  UPDATE users
  SET global_ban_reason = p_reason
  WHERE id = p_target_user_id;

END;
$$;


--
-- Name: update_user_uid_on_approval(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_uid_on_approval() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- If join_status changed to 'approved' and there is a pending_uid
  IF NEW.join_status = 'approved' AND OLD.join_status != 'approved' AND NEW.pending_uid IS NOT NULL THEN
    -- Only update if the user's uid is currently null or different
    UPDATE users SET uid = NEW.pending_uid WHERE id = NEW.user_id AND (uid IS NULL OR uid = '');
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: verify_union_passphrase(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_union_passphrase(p_union_id uuid, p_passphrase text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_stored text;
BEGIN
  SELECT passphrase INTO v_stored
  FROM public.union_join_passphrases
  WHERE union_id = p_union_id;

  -- 암구호 미설정(행 없음 또는 공백) => 통과
  IF v_stored IS NULL OR length(btrim(v_stored)) = 0 THEN
    RETURN true;
  END IF;

  RETURN p_passphrase IS NOT NULL AND v_stored = p_passphrase;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    actor_id uuid,
    action_type public.action_type_enum NOT NULL,
    description text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    name text NOT NULL,
    type public.channel_type_enum DEFAULT 'general'::public.channel_type_enum,
    is_fixed boolean DEFAULT false,
    deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.channels REPLICA IDENTITY FULL;


--
-- Name: chat_read_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_read_state (
    user_id uuid NOT NULL,
    scope_key text NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: daily_statistics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_statistics (
    date date DEFAULT CURRENT_DATE NOT NULL,
    total_users integer DEFAULT 0,
    active_users integer DEFAULT 0,
    approved_unions integer DEFAULT 0,
    pending_unions integer DEFAULT 0,
    banned_unions integer DEFAULT 0,
    pending_reports integer DEFAULT 0,
    last_updated timestamp with time zone DEFAULT now()
);


--
-- Name: emoticon_packs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emoticon_packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: emoticons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.emoticons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pack_id uuid,
    name text NOT NULL,
    image_url text NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: game_icons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_icons (
    id integer NOT NULL,
    category text NOT NULL,
    name text NOT NULL,
    image_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: game_icons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_icons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_icons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_icons_id_seq OWNED BY public.game_icons.id;


--
-- Name: global_raid_bosses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.global_raid_bosses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_name text NOT NULL,
    element public.element_enum NOT NULL,
    name text NOT NULL,
    boss_number integer DEFAULT 1 NOT NULL,
    boss_grade public.boss_grade_enum DEFAULT '로드급'::public.boss_grade_enum NOT NULL,
    image_url text,
    image_alt text,
    CONSTRAINT global_raid_bosses_boss_number_check CHECK (((boss_number >= 1) AND (boss_number <= 5)))
);


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid,
    raid_message_id uuid,
    user_id uuid NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_reactions_emoji_len CHECK (((char_length(emoji) >= 1) AND (char_length(emoji) <= 16))),
    CONSTRAINT message_reactions_one_target CHECK (((message_id IS NULL) <> (raid_message_id IS NULL)))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid,
    user_id uuid,
    content text NOT NULL,
    image_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone
);

ALTER TABLE ONLY public.messages REPLICA IDENTITY FULL;


--
-- Name: mock_battles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mock_battles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    user_id uuid,
    boss_status_id uuid,
    deck_info text,
    expected_damage bigint NOT NULL,
    status public.mock_battle_status_enum DEFAULT 'pending'::public.mock_battle_status_enum,
    real_damage bigint,
    is_last_hit boolean DEFAULT false,
    completed_at timestamp with time zone,
    slot_1_nikke_id integer,
    slot_2_nikke_id integer,
    slot_3_nikke_id integer,
    slot_4_nikke_id integer,
    slot_5_nikke_id integer,
    synchro_level integer,
    is_queued boolean DEFAULT false,
    manual_nickname text,
    is_admin_written boolean DEFAULT false,
    is_in_calc boolean DEFAULT false,
    memo text
);

ALTER TABLE ONLY public.mock_battles REPLICA IDENTITY FULL;


--
-- Name: nikkes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nikkes (
    id integer NOT NULL,
    name text NOT NULL,
    class text NOT NULL,
    manufacturer text NOT NULL,
    weapon text NOT NULL,
    element text NOT NULL,
    image_url text,
    aliases text DEFAULT ''::text,
    alt_text text DEFAULT ''::text,
    burst_type smallint NOT NULL
);


--
-- Name: nikkes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.nikkes ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.nikkes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: profile_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_images (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    image_url text NOT NULL,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    aliases text DEFAULT ''::text
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: raid_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raid_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    user_id uuid,
    room_type text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    payload jsonb,
    updated_at timestamp with time zone,
    deleted_at timestamp with time zone,
    season_name text,
    CONSTRAINT raid_messages_room_type_check CHECK ((room_type = ANY (ARRAY['general'::text, 'admin'::text])))
);

ALTER TABLE ONLY public.raid_messages REPLICA IDENTITY FULL;


--
-- Name: raid_season_hp_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raid_season_hp_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    season_name text NOT NULL,
    stage_level integer NOT NULL,
    lord_hp bigint NOT NULL,
    tyrant_hp bigint NOT NULL
);


--
-- Name: raid_seasons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.raid_seasons (
    name text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: recommended_squads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recommended_squads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    season_name text NOT NULL,
    boss_number integer NOT NULL,
    name text NOT NULL,
    slot_1_nikke_id integer,
    slot_2_nikke_id integer,
    slot_3_nikke_id integer,
    slot_4_nikke_id integer,
    slot_5_nikke_id integer,
    created_by uuid,
    memo text
);

ALTER TABLE ONLY public.recommended_squads REPLICA IDENTITY FULL;


--
-- Name: reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reporter_id uuid,
    target_user_id uuid,
    type text NOT NULL,
    category text NOT NULL,
    content text NOT NULL,
    status public.report_status_enum DEFAULT 'pending'::public.report_status_enum,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: site_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    is_active boolean DEFAULT true,
    grant_reason text,
    revoke_reason text,
    created_at timestamp with time zone DEFAULT now(),
    revoked_at timestamp with time zone
);


--
-- Name: site_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content text NOT NULL,
    created_by uuid,
    expires_at timestamp with time zone,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: uid_change_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uid_change_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    old_uid text,
    new_uid text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);


--
-- Name: union_boss_memos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_boss_memos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    season_name text NOT NULL,
    boss_number integer NOT NULL,
    memo text,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: union_join_passphrases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_join_passphrases (
    union_id uuid NOT NULL,
    passphrase text NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: union_member_note_fields; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_member_note_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid NOT NULL,
    label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: union_member_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_member_notes (
    member_id uuid NOT NULL,
    notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: union_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    user_id uuid,
    in_game_name text NOT NULL,
    role public.role_enum DEFAULT 'member'::public.role_enum,
    join_status public.join_status_enum DEFAULT 'pending'::public.join_status_enum,
    status_message text,
    in_battle_boss_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    pending_uid text
);


--
-- Name: union_nickname_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_nickname_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    user_id uuid,
    old_nickname text,
    new_nickname text NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);


--
-- Name: union_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone,
    created_by uuid,
    expires_at timestamp with time zone
);


--
-- Name: union_raid_season_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_raid_season_settings (
    union_id uuid NOT NULL,
    season_name text NOT NULL,
    is_locked boolean DEFAULT false
);


--
-- Name: union_raid_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_raid_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid,
    global_boss_id uuid,
    current_hp bigint NOT NULL,
    is_cleared boolean DEFAULT false,
    stage_level integer DEFAULT 1 NOT NULL,
    cleared_at timestamp with time zone
);

ALTER TABLE ONLY public.union_raid_status REPLICA IDENTITY FULL;


--
-- Name: union_settlement_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_settlement_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_id uuid NOT NULL,
    season_name text NOT NULL,
    member_key text NOT NULL,
    user_id uuid,
    manual_nickname text,
    synchro_level integer,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    prev_synchro_level integer,
    display_name text,
    synchro_override integer
);


--
-- Name: union_settlement_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.union_settlement_status (
    union_id uuid NOT NULL,
    season_name text NOT NULL,
    is_finalized boolean DEFAULT false NOT NULL,
    finalized_at timestamp with time zone,
    finalized_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: unions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    union_code text NOT NULL,
    name text NOT NULL,
    server_region public.server_region_enum NOT NULL,
    description text,
    status public.union_status_enum DEFAULT 'pending'::public.union_status_enum,
    owner_id uuid,
    log_retention_days integer DEFAULT 30,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_favorite_nikkes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_favorite_nikkes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    nikke_id integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_notice_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notice_reads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    notice_id uuid,
    read_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    union_id uuid,
    type public.notification_type_enum DEFAULT 'mention'::public.notification_type_enum,
    message text NOT NULL,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_site_notice_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_site_notice_reads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    site_notice_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    username text NOT NULL,
    uid text,
    global_ban_reason text,
    created_at timestamp with time zone DEFAULT now(),
    last_login_at timestamp with time zone,
    synchro_level integer DEFAULT 1,
    profile_image_id uuid
);

ALTER TABLE ONLY public.users REPLICA IDENTITY FULL;


--
-- Name: game_icons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_icons ALTER COLUMN id SET DEFAULT nextval('public.game_icons_id_seq'::regclass);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: chat_read_state chat_read_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_read_state
    ADD CONSTRAINT chat_read_state_pkey PRIMARY KEY (user_id, scope_key);


--
-- Name: daily_statistics daily_statistics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_statistics
    ADD CONSTRAINT daily_statistics_pkey PRIMARY KEY (date);


--
-- Name: emoticon_packs emoticon_packs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emoticon_packs
    ADD CONSTRAINT emoticon_packs_pkey PRIMARY KEY (id);


--
-- Name: emoticons emoticons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emoticons
    ADD CONSTRAINT emoticons_pkey PRIMARY KEY (id);


--
-- Name: game_icons game_icons_category_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_icons
    ADD CONSTRAINT game_icons_category_name_key UNIQUE (category, name);


--
-- Name: game_icons game_icons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_icons
    ADD CONSTRAINT game_icons_pkey PRIMARY KEY (id);


--
-- Name: global_raid_bosses global_raid_bosses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_raid_bosses
    ADD CONSTRAINT global_raid_bosses_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: mock_battles mock_battles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_pkey PRIMARY KEY (id);


--
-- Name: nikkes nikkes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nikkes
    ADD CONSTRAINT nikkes_pkey PRIMARY KEY (id);


--
-- Name: profile_images profile_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_images
    ADD CONSTRAINT profile_images_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: raid_messages raid_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_messages
    ADD CONSTRAINT raid_messages_pkey PRIMARY KEY (id);


--
-- Name: raid_season_hp_settings raid_season_hp_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_season_hp_settings
    ADD CONSTRAINT raid_season_hp_settings_pkey PRIMARY KEY (id);


--
-- Name: raid_season_hp_settings raid_season_hp_settings_season_name_stage_level_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_season_hp_settings
    ADD CONSTRAINT raid_season_hp_settings_season_name_stage_level_key UNIQUE (season_name, stage_level);


--
-- Name: raid_seasons raid_seasons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_seasons
    ADD CONSTRAINT raid_seasons_pkey PRIMARY KEY (name);


--
-- Name: recommended_squads recommended_squads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_pkey PRIMARY KEY (id);


--
-- Name: reports reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_pkey PRIMARY KEY (id);


--
-- Name: site_admins site_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_admins
    ADD CONSTRAINT site_admins_pkey PRIMARY KEY (id);


--
-- Name: site_notices site_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_notices
    ADD CONSTRAINT site_notices_pkey PRIMARY KEY (id);


--
-- Name: uid_change_requests uid_change_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uid_change_requests
    ADD CONSTRAINT uid_change_requests_pkey PRIMARY KEY (id);


--
-- Name: union_boss_memos union_boss_memos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_boss_memos
    ADD CONSTRAINT union_boss_memos_pkey PRIMARY KEY (id);


--
-- Name: union_boss_memos union_boss_memos_union_id_season_name_boss_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_boss_memos
    ADD CONSTRAINT union_boss_memos_union_id_season_name_boss_number_key UNIQUE (union_id, season_name, boss_number);


--
-- Name: union_join_passphrases union_join_passphrases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_join_passphrases
    ADD CONSTRAINT union_join_passphrases_pkey PRIMARY KEY (union_id);


--
-- Name: union_member_note_fields union_member_note_fields_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_member_note_fields
    ADD CONSTRAINT union_member_note_fields_pkey PRIMARY KEY (id);


--
-- Name: union_member_notes union_member_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_member_notes
    ADD CONSTRAINT union_member_notes_pkey PRIMARY KEY (member_id);


--
-- Name: union_members union_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_members
    ADD CONSTRAINT union_members_pkey PRIMARY KEY (id);


--
-- Name: union_members union_members_union_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_members
    ADD CONSTRAINT union_members_union_id_user_id_key UNIQUE (union_id, user_id);


--
-- Name: union_nickname_requests union_nickname_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_nickname_requests
    ADD CONSTRAINT union_nickname_requests_pkey PRIMARY KEY (id);


--
-- Name: union_notices union_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_notices
    ADD CONSTRAINT union_notices_pkey PRIMARY KEY (id);


--
-- Name: union_raid_season_settings union_raid_season_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_raid_season_settings
    ADD CONSTRAINT union_raid_season_settings_pkey PRIMARY KEY (union_id, season_name);


--
-- Name: union_raid_status union_raid_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_raid_status
    ADD CONSTRAINT union_raid_status_pkey PRIMARY KEY (id);


--
-- Name: union_settlement_members union_settlement_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_members
    ADD CONSTRAINT union_settlement_members_pkey PRIMARY KEY (id);


--
-- Name: union_settlement_members union_settlement_members_union_id_season_name_member_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_members
    ADD CONSTRAINT union_settlement_members_union_id_season_name_member_key_key UNIQUE (union_id, season_name, member_key);


--
-- Name: union_settlement_status union_settlement_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_status
    ADD CONSTRAINT union_settlement_status_pkey PRIMARY KEY (union_id, season_name);


--
-- Name: unions unions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unions
    ADD CONSTRAINT unions_pkey PRIMARY KEY (id);


--
-- Name: unions unions_union_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unions
    ADD CONSTRAINT unions_union_code_key UNIQUE (union_code);


--
-- Name: union_raid_status uq_union_raid_status_union_boss_stage; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_raid_status
    ADD CONSTRAINT uq_union_raid_status_union_boss_stage UNIQUE (union_id, global_boss_id, stage_level);


--
-- Name: user_favorite_nikkes user_favorite_nikkes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorite_nikkes
    ADD CONSTRAINT user_favorite_nikkes_pkey PRIMARY KEY (id);


--
-- Name: user_favorite_nikkes user_favorite_nikkes_user_id_nikke_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorite_nikkes
    ADD CONSTRAINT user_favorite_nikkes_user_id_nikke_id_key UNIQUE (user_id, nikke_id);


--
-- Name: user_notice_reads user_notice_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notice_reads
    ADD CONSTRAINT user_notice_reads_pkey PRIMARY KEY (id);


--
-- Name: user_notice_reads user_notice_reads_user_id_notice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notice_reads
    ADD CONSTRAINT user_notice_reads_user_id_notice_id_key UNIQUE (user_id, notice_id);


--
-- Name: user_notifications user_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_pkey PRIMARY KEY (id);


--
-- Name: user_site_notice_reads user_site_notice_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_site_notice_reads
    ADD CONSTRAINT user_site_notice_reads_pkey PRIMARY KEY (id);


--
-- Name: user_site_notice_reads user_site_notice_reads_user_id_site_notice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_site_notice_reads
    ADD CONSTRAINT user_site_notice_reads_user_id_site_notice_id_key UNIQUE (user_id, site_notice_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_uid_key UNIQUE (uid);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_emoticons_pack_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emoticons_pack_id ON public.emoticons USING btree (pack_id);


--
-- Name: idx_raid_messages_union_season_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_raid_messages_union_season_room ON public.raid_messages USING btree (union_id, season_name, room_type, created_at DESC);


--
-- Name: message_reactions_msg_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_reactions_msg_uniq ON public.message_reactions USING btree (message_id, user_id, emoji) WHERE (message_id IS NOT NULL);


--
-- Name: message_reactions_raid_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX message_reactions_raid_uniq ON public.message_reactions USING btree (raid_message_id, user_id, emoji) WHERE (raid_message_id IS NOT NULL);


--
-- Name: messages_channel_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_channel_created_idx ON public.messages USING btree (channel_id, created_at DESC);


--
-- Name: mock_battles_boss_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mock_battles_boss_status_idx ON public.mock_battles USING btree (boss_status_id);


--
-- Name: mock_battles_union_manual_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mock_battles_union_manual_idx ON public.mock_battles USING btree (union_id, manual_nickname) WHERE (is_admin_written = true);


--
-- Name: mock_battles_union_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mock_battles_union_status_idx ON public.mock_battles USING btree (union_id, status);


--
-- Name: mock_battles_union_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mock_battles_union_user_idx ON public.mock_battles USING btree (union_id, user_id) WHERE (is_admin_written = false);


--
-- Name: push_subscriptions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_id_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: recommended_squads_union_season_boss_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX recommended_squads_union_season_boss_idx ON public.recommended_squads USING btree (union_id, season_name, boss_number);


--
-- Name: union_member_note_fields_union_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX union_member_note_fields_union_idx ON public.union_member_note_fields USING btree (union_id);


--
-- Name: union_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX union_members_user_idx ON public.union_members USING btree (user_id);


--
-- Name: union_raid_status_boss_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX union_raid_status_boss_idx ON public.union_raid_status USING btree (global_boss_id);


--
-- Name: union_settlement_members_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX union_settlement_members_scope_idx ON public.union_settlement_members USING btree (union_id, season_name);


--
-- Name: uq_union_raid_season_settings_union_season; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_union_raid_season_settings_union_season ON public.union_raid_season_settings USING btree (union_id, season_name);


--
-- Name: messages trg_guard_message_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_message_location BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.guard_message_location();


--
-- Name: raid_messages trg_guard_message_location; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_message_location BEFORE UPDATE ON public.raid_messages FOR EACH ROW EXECUTE FUNCTION public.guard_message_location();


--
-- Name: union_members trg_guard_union_members_roles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_union_members_roles BEFORE DELETE OR UPDATE ON public.union_members FOR EACH ROW EXECUTE FUNCTION public.guard_union_members_roles();


--
-- Name: unions trg_guard_unions_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_unions_status BEFORE UPDATE ON public.unions FOR EACH ROW EXECUTE FUNCTION public.guard_unions_status();


--
-- Name: users trg_guard_users_protected_columns; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_guard_users_protected_columns BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.guard_users_protected_columns();


--
-- Name: union_raid_status trg_union_raid_status_cleared_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_union_raid_status_cleared_at BEFORE UPDATE ON public.union_raid_status FOR EACH ROW EXECUTE FUNCTION public.set_union_raid_status_cleared_at();


--
-- Name: union_members trg_update_user_uid_on_approval; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_update_user_uid_on_approval AFTER UPDATE OF join_status ON public.union_members FOR EACH ROW EXECUTE FUNCTION public.update_user_uid_on_approval();


--
-- Name: user_notifications user_notifications; Type: TRIGGER; Schema: public; Owner: -
--

-- Web Push 웹훅 트리거(user_notifications → send-push)는 시크릿이 필요하므로 여기서 만들지 않는다.
-- Supabase 대시보드 Database → Webhooks에서 직접 설정한다 (README 참고).


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: audit_logs audit_logs_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: channels channels_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: chat_read_state chat_read_state_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_read_state
    ADD CONSTRAINT chat_read_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: emoticons emoticons_pack_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.emoticons
    ADD CONSTRAINT emoticons_pack_id_fkey FOREIGN KEY (pack_id) REFERENCES public.emoticon_packs(id) ON DELETE CASCADE;


--
-- Name: global_raid_bosses fk_season; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.global_raid_bosses
    ADD CONSTRAINT fk_season FOREIGN KEY (season_name) REFERENCES public.raid_seasons(name) ON DELETE CASCADE;


--
-- Name: raid_season_hp_settings fk_season_hp; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_season_hp_settings
    ADD CONSTRAINT fk_season_hp FOREIGN KEY (season_name) REFERENCES public.raid_seasons(name) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_raid_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_raid_message_id_fkey FOREIGN KEY (raid_message_id) REFERENCES public.raid_messages(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: messages messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: mock_battles mock_battles_boss_status_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_boss_status_id_fkey FOREIGN KEY (boss_status_id) REFERENCES public.union_raid_status(id) ON DELETE CASCADE;


--
-- Name: mock_battles mock_battles_slot_1_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_slot_1_nikke_id_fkey FOREIGN KEY (slot_1_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: mock_battles mock_battles_slot_2_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_slot_2_nikke_id_fkey FOREIGN KEY (slot_2_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: mock_battles mock_battles_slot_3_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_slot_3_nikke_id_fkey FOREIGN KEY (slot_3_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: mock_battles mock_battles_slot_4_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_slot_4_nikke_id_fkey FOREIGN KEY (slot_4_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: mock_battles mock_battles_slot_5_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_slot_5_nikke_id_fkey FOREIGN KEY (slot_5_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: mock_battles mock_battles_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: mock_battles mock_battles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mock_battles
    ADD CONSTRAINT mock_battles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: raid_messages raid_messages_season_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_messages
    ADD CONSTRAINT raid_messages_season_name_fkey FOREIGN KEY (season_name) REFERENCES public.raid_seasons(name) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: raid_messages raid_messages_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_messages
    ADD CONSTRAINT raid_messages_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: raid_messages raid_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.raid_messages
    ADD CONSTRAINT raid_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: recommended_squads recommended_squads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: recommended_squads recommended_squads_slot_1_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_slot_1_nikke_id_fkey FOREIGN KEY (slot_1_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: recommended_squads recommended_squads_slot_2_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_slot_2_nikke_id_fkey FOREIGN KEY (slot_2_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: recommended_squads recommended_squads_slot_3_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_slot_3_nikke_id_fkey FOREIGN KEY (slot_3_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: recommended_squads recommended_squads_slot_4_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_slot_4_nikke_id_fkey FOREIGN KEY (slot_4_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: recommended_squads recommended_squads_slot_5_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_slot_5_nikke_id_fkey FOREIGN KEY (slot_5_nikke_id) REFERENCES public.nikkes(id) ON DELETE SET NULL;


--
-- Name: recommended_squads recommended_squads_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recommended_squads
    ADD CONSTRAINT recommended_squads_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: reports reports_reporter_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reports reports_target_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reports
    ADD CONSTRAINT reports_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: site_admins site_admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_admins
    ADD CONSTRAINT site_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: site_notices site_notices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_notices
    ADD CONSTRAINT site_notices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: uid_change_requests uid_change_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uid_change_requests
    ADD CONSTRAINT uid_change_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: union_boss_memos union_boss_memos_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_boss_memos
    ADD CONSTRAINT union_boss_memos_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_join_passphrases union_join_passphrases_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_join_passphrases
    ADD CONSTRAINT union_join_passphrases_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_join_passphrases union_join_passphrases_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_join_passphrases
    ADD CONSTRAINT union_join_passphrases_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: union_member_note_fields union_member_note_fields_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_member_note_fields
    ADD CONSTRAINT union_member_note_fields_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_member_notes union_member_notes_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_member_notes
    ADD CONSTRAINT union_member_notes_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.union_members(id) ON DELETE CASCADE;


--
-- Name: union_members union_members_in_battle_boss_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_members
    ADD CONSTRAINT union_members_in_battle_boss_id_fkey FOREIGN KEY (in_battle_boss_id) REFERENCES public.union_raid_status(id) ON DELETE SET NULL;


--
-- Name: union_members union_members_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_members
    ADD CONSTRAINT union_members_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_members union_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_members
    ADD CONSTRAINT union_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: union_nickname_requests union_nickname_requests_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_nickname_requests
    ADD CONSTRAINT union_nickname_requests_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_nickname_requests union_nickname_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_nickname_requests
    ADD CONSTRAINT union_nickname_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: union_notices union_notices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_notices
    ADD CONSTRAINT union_notices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: union_notices union_notices_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_notices
    ADD CONSTRAINT union_notices_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_raid_season_settings union_raid_season_settings_season_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_raid_season_settings
    ADD CONSTRAINT union_raid_season_settings_season_name_fkey FOREIGN KEY (season_name) REFERENCES public.raid_seasons(name) ON DELETE CASCADE;


--
-- Name: union_raid_season_settings union_raid_season_settings_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_raid_season_settings
    ADD CONSTRAINT union_raid_season_settings_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_raid_status union_raid_status_global_boss_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_raid_status
    ADD CONSTRAINT union_raid_status_global_boss_id_fkey FOREIGN KEY (global_boss_id) REFERENCES public.global_raid_bosses(id) ON DELETE CASCADE;


--
-- Name: union_raid_status union_raid_status_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_raid_status
    ADD CONSTRAINT union_raid_status_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_settlement_members union_settlement_members_season_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_members
    ADD CONSTRAINT union_settlement_members_season_name_fkey FOREIGN KEY (season_name) REFERENCES public.raid_seasons(name) ON DELETE CASCADE;


--
-- Name: union_settlement_members union_settlement_members_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_members
    ADD CONSTRAINT union_settlement_members_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: union_settlement_members union_settlement_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_members
    ADD CONSTRAINT union_settlement_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: union_settlement_status union_settlement_status_finalized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_status
    ADD CONSTRAINT union_settlement_status_finalized_by_fkey FOREIGN KEY (finalized_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: union_settlement_status union_settlement_status_season_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_status
    ADD CONSTRAINT union_settlement_status_season_name_fkey FOREIGN KEY (season_name) REFERENCES public.raid_seasons(name) ON DELETE CASCADE;


--
-- Name: union_settlement_status union_settlement_status_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.union_settlement_status
    ADD CONSTRAINT union_settlement_status_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: unions unions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unions
    ADD CONSTRAINT unions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: user_favorite_nikkes user_favorite_nikkes_nikke_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorite_nikkes
    ADD CONSTRAINT user_favorite_nikkes_nikke_id_fkey FOREIGN KEY (nikke_id) REFERENCES public.nikkes(id) ON DELETE CASCADE;


--
-- Name: user_favorite_nikkes user_favorite_nikkes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_favorite_nikkes
    ADD CONSTRAINT user_favorite_nikkes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_notice_reads user_notice_reads_notice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notice_reads
    ADD CONSTRAINT user_notice_reads_notice_id_fkey FOREIGN KEY (notice_id) REFERENCES public.union_notices(id) ON DELETE CASCADE;


--
-- Name: user_notice_reads user_notice_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notice_reads
    ADD CONSTRAINT user_notice_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_notifications user_notifications_union_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_union_id_fkey FOREIGN KEY (union_id) REFERENCES public.unions(id) ON DELETE CASCADE;


--
-- Name: user_notifications user_notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_notifications
    ADD CONSTRAINT user_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_site_notice_reads user_site_notice_reads_site_notice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_site_notice_reads
    ADD CONSTRAINT user_site_notice_reads_site_notice_id_fkey FOREIGN KEY (site_notice_id) REFERENCES public.site_notices(id) ON DELETE CASCADE;


--
-- Name: user_site_notice_reads user_site_notice_reads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_site_notice_reads
    ADD CONSTRAINT user_site_notice_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_profile_image_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_profile_image_id_fkey FOREIGN KEY (profile_image_id) REFERENCES public.profile_images(id) ON DELETE SET NULL;


--
-- Name: union_join_passphrases Admin bypass union_join_passphrases; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin bypass union_join_passphrases" ON public.union_join_passphrases USING (public.is_site_admin());


--
-- Name: union_members Admin bypass union_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin bypass union_members" ON public.union_members USING (public.is_site_admin());


--
-- Name: unions Admin bypass unions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin bypass unions" ON public.unions USING (public.is_site_admin());


--
-- Name: users Admin bypass users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin bypass users" ON public.users USING (public.is_site_admin());


--
-- Name: uid_change_requests Admin can delete uid requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can delete uid requests" ON public.uid_change_requests FOR DELETE USING (public.is_site_admin());


--
-- Name: uid_change_requests Admin can update uid requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admin can update uid requests" ON public.uid_change_requests FOR UPDATE USING (public.is_site_admin());


--
-- Name: profile_images Admins can delete profile images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete profile images" ON public.profile_images FOR DELETE USING (public.is_site_admin());


--
-- Name: union_raid_status Admins can delete union_raid_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete union_raid_status" ON public.union_raid_status FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = union_raid_status.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = 'admin'::public.role_enum)))));


--
-- Name: profile_images Admins can insert profile images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert profile images" ON public.profile_images FOR INSERT WITH CHECK (public.is_site_admin());


--
-- Name: union_boss_memos Admins can insert union_boss_memos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert union_boss_memos" ON public.union_boss_memos FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_boss_memos.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))));


--
-- Name: union_raid_season_settings Admins can manage union_raid_season_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage union_raid_season_settings" ON public.union_raid_season_settings USING ((EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = union_raid_season_settings.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = 'admin'::public.role_enum)))));


--
-- Name: union_nickname_requests Admins can update nickname requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update nickname requests" ON public.union_nickname_requests FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_nickname_requests.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))));


--
-- Name: profile_images Admins can update profile images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update profile images" ON public.profile_images FOR UPDATE USING (public.is_site_admin()) WITH CHECK (public.is_site_admin());


--
-- Name: union_boss_memos Admins can update union_boss_memos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update union_boss_memos" ON public.union_boss_memos FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_boss_memos.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))));


--
-- Name: daily_statistics Admins have full access to daily_statistics; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to daily_statistics" ON public.daily_statistics USING (public.is_site_admin());


--
-- Name: global_raid_bosses Admins have full access to global_raid_bosses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to global_raid_bosses" ON public.global_raid_bosses USING (public.is_site_admin());


--
-- Name: raid_season_hp_settings Admins have full access to raid_season_hp_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to raid_season_hp_settings" ON public.raid_season_hp_settings USING (public.is_site_admin());


--
-- Name: raid_seasons Admins have full access to raid_seasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to raid_seasons" ON public.raid_seasons USING (public.is_site_admin());


--
-- Name: reports Admins have full access to reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to reports" ON public.reports USING (public.is_site_admin());


--
-- Name: union_members Admins have full access to union_members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to union_members" ON public.union_members USING (public.is_site_admin());


--
-- Name: unions Admins have full access to unions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins have full access to unions" ON public.unions USING (public.is_site_admin());


--
-- Name: emoticon_packs Admins manage emoticon packs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage emoticon packs" ON public.emoticon_packs USING (public.is_site_admin()) WITH CHECK (public.is_site_admin());


--
-- Name: emoticons Admins manage emoticons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage emoticons" ON public.emoticons USING (public.is_site_admin()) WITH CHECK (public.is_site_admin());


--
-- Name: nikkes Admins manage nikkes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins manage nikkes" ON public.nikkes TO authenticated USING (( SELECT public.is_site_admin() AS is_site_admin)) WITH CHECK (( SELECT public.is_site_admin() AS is_site_admin));


--
-- Name: global_raid_bosses Allow select for all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow select for all" ON public.global_raid_bosses FOR SELECT TO authenticated USING (true);


--
-- Name: raid_season_hp_settings Allow select for all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow select for all" ON public.raid_season_hp_settings FOR SELECT TO authenticated USING (true);


--
-- Name: raid_seasons Allow select for all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow select for all" ON public.raid_seasons FOR SELECT TO authenticated USING (true);


--
-- Name: game_icons Anyone can read game_icons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read game_icons" ON public.game_icons FOR SELECT USING (true);


--
-- Name: union_raid_season_settings Anyone can read season settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read season settings" ON public.union_raid_season_settings FOR SELECT TO authenticated USING (true);


--
-- Name: union_raid_season_settings Anyone can read union_raid_season_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read union_raid_season_settings" ON public.union_raid_season_settings FOR SELECT USING (true);


--
-- Name: emoticon_packs Anyone can view emoticon packs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view emoticon packs" ON public.emoticon_packs FOR SELECT USING (true);


--
-- Name: emoticons Anyone can view emoticons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view emoticons" ON public.emoticons FOR SELECT USING (true);


--
-- Name: profile_images Anyone can view profile images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view profile images" ON public.profile_images FOR SELECT USING (true);


--
-- Name: unions Anyone can view unions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view unions" ON public.unions FOR SELECT USING (true);


--
-- Name: audit_logs Authenticated users can insert audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (((actor_id = ( SELECT auth.uid() AS uid)) AND (( SELECT public.is_site_admin() AS is_site_admin) OR (union_id IN ( SELECT public.my_approved_union_ids() AS my_approved_union_ids)))));


--
-- Name: nikkes Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.nikkes FOR SELECT USING (true);


--
-- Name: global_raid_bosses Everyone can view global_raid_bosses; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Everyone can view global_raid_bosses" ON public.global_raid_bosses FOR SELECT USING (true);


--
-- Name: raid_season_hp_settings Everyone can view raid_season_hp_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Everyone can view raid_season_hp_settings" ON public.raid_season_hp_settings FOR SELECT USING (true);


--
-- Name: raid_seasons Everyone can view raid_seasons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Everyone can view raid_seasons" ON public.raid_seasons FOR SELECT USING (true);


--
-- Name: raid_messages Members can update own raid messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can update own raid messages" ON public.raid_messages FOR UPDATE USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = raid_messages.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (union_members.join_status = 'approved'::public.join_status_enum)))))) WITH CHECK (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = raid_messages.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (union_members.join_status = 'approved'::public.join_status_enum))))));


--
-- Name: game_icons Only admins can manage game_icons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Only admins can manage game_icons" ON public.game_icons USING ((EXISTS ( SELECT 1
   FROM public.site_admins
  WHERE ((site_admins.user_id = auth.uid()) AND (site_admins.is_active = true)))));


--
-- Name: channels Site admins can insert channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Site admins can insert channels" ON public.channels FOR INSERT WITH CHECK (public.is_site_admin());


--
-- Name: union_members Union admins can delete members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can delete members" ON public.union_members FOR DELETE USING ((((user_id = ( SELECT auth.uid() AS uid)) AND (join_status <> 'banned'::public.join_status_enum)) OR (union_id IN ( SELECT public.my_managed_union_ids() AS my_managed_union_ids)) OR ( SELECT public.is_site_admin() AS is_site_admin)));


--
-- Name: union_raid_status Union admins can delete union_raid_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can delete union_raid_status" ON public.union_raid_status FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_status.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: channels Union admins can manage channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can manage channels" ON public.channels USING ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = channels.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))));


--
-- Name: union_members Union admins can manage members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can manage members" ON public.union_members FOR UPDATE USING (((union_id IN ( SELECT public.my_managed_union_ids() AS my_managed_union_ids)) OR ( SELECT public.is_site_admin() AS is_site_admin)));


--
-- Name: union_raid_season_settings Union admins manage season settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins manage season settings" ON public.union_raid_season_settings TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_season_settings.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin())) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_season_settings.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_join_passphrases Union managers manage join passphrase; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union managers manage join passphrase" ON public.union_join_passphrases USING ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_join_passphrases.union_id) AND (m.user_id = auth.uid()) AND (m.join_status = 'approved'::public.join_status_enum) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_join_passphrases.union_id) AND (m.user_id = auth.uid()) AND (m.join_status = 'approved'::public.join_status_enum) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))));


--
-- Name: unions Union owner can update union; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union owner can update union" ON public.unions FOR UPDATE USING (((owner_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_site_admin() AS is_site_admin))) WITH CHECK ((( SELECT public.is_site_admin() AS is_site_admin) OR (owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = unions.id) AND (m.user_id = unions.owner_id) AND (m.join_status = 'approved'::public.join_status_enum))))));


--
-- Name: user_favorite_nikkes Users can delete own favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own favorites" ON public.user_favorite_nikkes FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: user_notifications Users can delete their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own notifications" ON public.user_notifications FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: messages Users can insert messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert messages" ON public.messages FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (channel_id IN ( SELECT channels.id
   FROM public.channels
  WHERE ((channels.union_id IN ( SELECT union_members.union_id
           FROM public.union_members
          WHERE ((union_members.user_id = auth.uid()) AND (union_members.join_status = 'approved'::public.join_status_enum)))) AND ((channels.type <> ALL (ARRAY['notice'::public.channel_type_enum, 'admin_only'::public.channel_type_enum, 'raid_order'::public.channel_type_enum])) OR (auth.uid() IN ( SELECT union_members.user_id
           FROM public.union_members
          WHERE ((union_members.union_id = channels.union_id) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))))))));


--
-- Name: user_favorite_nikkes Users can insert own favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own favorites" ON public.user_favorite_nikkes FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: union_nickname_requests Users can insert own nickname requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own nickname requests" ON public.union_nickname_requests FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = union_nickname_requests.union_id) AND (union_members.user_id = auth.uid()))))));


--
-- Name: uid_change_requests Users can insert own uid requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own uid requests" ON public.uid_change_requests FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ((status)::text = 'pending'::text) AND (resolved_at IS NULL)));


--
-- Name: unions Users can insert pending unions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert pending unions" ON public.unions FOR INSERT TO authenticated WITH CHECK (((owner_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(status, 'pending'::public.union_status_enum) = 'pending'::public.union_status_enum)));


--
-- Name: raid_messages Users can insert raid messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert raid messages" ON public.raid_messages FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = raid_messages.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum) AND ((raid_messages.room_type = 'general'::text) OR ((raid_messages.room_type = 'admin'::text) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))))));


--
-- Name: reports Users can insert reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert reports" ON public.reports FOR INSERT TO authenticated WITH CHECK (((reporter_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::public.report_status_enum) AND (admin_notes IS NULL)));


--
-- Name: user_notice_reads Users can insert their own notice reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own notice reads" ON public.user_notice_reads FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: union_nickname_requests Users can read own nickname requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own nickname requests" ON public.union_nickname_requests FOR SELECT USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = union_nickname_requests.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))));


--
-- Name: user_notice_reads Users can read their own notice reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their own notice reads" ON public.user_notice_reads FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: user_notifications Users can read their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read their own notifications" ON public.user_notifications FOR SELECT USING ((user_id = auth.uid()));


--
-- Name: raid_messages Users can read union raid messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read union raid messages" ON public.raid_messages FOR SELECT USING (((union_id IN ( SELECT union_members.union_id
   FROM public.union_members
  WHERE ((union_members.user_id = auth.uid()) AND (union_members.join_status = 'approved'::public.join_status_enum)))) AND ((room_type = 'general'::text) OR ((room_type = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = raid_messages.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))))));


--
-- Name: union_boss_memos Users can read union_boss_memos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read union_boss_memos" ON public.union_boss_memos FOR SELECT USING ((union_id IN ( SELECT union_members.union_id
   FROM public.union_members
  WHERE ((union_members.user_id = auth.uid()) AND (union_members.join_status = 'approved'::public.join_status_enum)))));


--
-- Name: messages Users can update own messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own messages" ON public.messages FOR UPDATE USING (((user_id = auth.uid()) OR (channel_id IN ( SELECT channels.id
   FROM public.channels
  WHERE (channels.union_id IN ( SELECT union_members.union_id
           FROM public.union_members
          WHERE ((union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (union_members.join_status = 'approved'::public.join_status_enum)))))))) WITH CHECK (((user_id = auth.uid()) OR (deleted_at IS NOT NULL)));


--
-- Name: users Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.users FOR UPDATE USING ((auth.uid() = id));


--
-- Name: user_notifications Users can update their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own notifications" ON public.user_notifications FOR UPDATE USING ((user_id = auth.uid()));


--
-- Name: unions Users can view approved unions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view approved unions" ON public.unions FOR SELECT USING ((status = 'approved'::public.union_status_enum));


--
-- Name: user_favorite_nikkes Users can view own favorites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own favorites" ON public.user_favorite_nikkes FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: reports Users can view own reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own reports" ON public.reports FOR SELECT USING ((auth.uid() = reporter_id));


--
-- Name: uid_change_requests Users can view own uid requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own uid requests" ON public.uid_change_requests FOR SELECT USING (((user_id = auth.uid()) OR public.is_site_admin()));


--
-- Name: user_notifications Users can view their own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own notifications" ON public.user_notifications FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: channels Users can view union channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view union channels" ON public.channels FOR SELECT USING (((union_id IN ( SELECT union_members.union_id
   FROM public.union_members
  WHERE ((union_members.user_id = auth.uid()) AND (union_members.join_status = 'approved'::public.join_status_enum)))) AND ((type <> 'admin_only'::public.channel_type_enum) OR (auth.uid() IN ( SELECT union_members.user_id
   FROM public.union_members
  WHERE ((union_members.union_id = channels.union_id) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))))));


--
-- Name: messages Users can view union messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view union messages" ON public.messages FOR SELECT USING ((channel_id IN ( SELECT channels.id
   FROM public.channels
  WHERE ((channels.union_id IN ( SELECT union_members.union_id
           FROM public.union_members
          WHERE ((union_members.user_id = auth.uid()) AND (union_members.join_status = 'approved'::public.join_status_enum)))) AND ((channels.type <> 'admin_only'::public.channel_type_enum) OR (auth.uid() IN ( SELECT union_members.user_id
           FROM public.union_members
          WHERE ((union_members.union_id = channels.union_id) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))))))));


--
-- Name: site_admins View own admin status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "View own admin status" ON public.site_admins FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings app_settings_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_admin_write ON public.app_settings USING (public.is_site_admin()) WITH CHECK (public.is_site_admin());


--
-- Name: app_settings app_settings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY app_settings_select ON public.app_settings FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_read_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.chat_read_state ENABLE ROW LEVEL SECURITY;

--
-- Name: chat_read_state chat_read_state_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_read_state_delete_own ON public.chat_read_state FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: chat_read_state chat_read_state_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_read_state_insert_own ON public.chat_read_state FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: chat_read_state chat_read_state_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_read_state_select_own ON public.chat_read_state FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: chat_read_state chat_read_state_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY chat_read_state_update_own ON public.chat_read_state FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: daily_statistics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.daily_statistics ENABLE ROW LEVEL SECURITY;

--
-- Name: emoticon_packs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emoticon_packs ENABLE ROW LEVEL SECURITY;

--
-- Name: emoticons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.emoticons ENABLE ROW LEVEL SECURITY;

--
-- Name: game_icons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.game_icons ENABLE ROW LEVEL SECURITY;

--
-- Name: global_raid_bosses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.global_raid_bosses ENABLE ROW LEVEL SECURITY;

--
-- Name: union_member_note_fields member_note_fields_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_note_fields_all ON public.union_member_note_fields TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_member_note_fields.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin())) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_member_note_fields.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_member_notes member_notes_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY member_notes_all ON public.union_member_notes TO authenticated USING (((EXISTS ( SELECT 1
   FROM (public.union_members target
     JOIN public.union_members me ON ((me.union_id = target.union_id)))
  WHERE ((target.id = union_member_notes.member_id) AND (me.user_id = auth.uid()) AND (me.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (me.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin())) WITH CHECK (((EXISTS ( SELECT 1
   FROM (public.union_members target
     JOIN public.union_members me ON ((me.union_id = target.union_id)))
  WHERE ((target.id = union_member_notes.member_id) AND (me.user_id = auth.uid()) AND (me.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (me.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: message_reactions message_reactions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_delete ON public.message_reactions FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: message_reactions message_reactions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_insert ON public.message_reactions FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1
   FROM ((public.messages msg
     JOIN public.channels c ON ((c.id = msg.channel_id)))
     JOIN public.union_members m ON ((m.union_id = c.union_id)))
  WHERE ((msg.id = message_reactions.message_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum) AND ((c.type <> 'admin_only'::public.channel_type_enum) OR (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))) OR (EXISTS ( SELECT 1
   FROM (public.raid_messages rm
     JOIN public.union_members m ON ((m.union_id = rm.union_id)))
  WHERE ((rm.id = message_reactions.raid_message_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum) AND ((rm.room_type <> 'admin'::text) OR (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))))));


--
-- Name: message_reactions message_reactions_season_lock_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_season_lock_delete ON public.message_reactions AS RESTRICTIVE FOR DELETE TO authenticated USING (((raid_message_id IS NULL) OR (NOT public.is_raid_message_locked(raid_message_id))));


--
-- Name: message_reactions message_reactions_season_lock_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_season_lock_insert ON public.message_reactions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (((raid_message_id IS NULL) OR (NOT public.is_raid_message_locked(raid_message_id))));


--
-- Name: message_reactions message_reactions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT TO authenticated USING ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM ((public.messages msg
     JOIN public.channels c ON ((c.id = msg.channel_id)))
     JOIN public.union_members m ON ((m.union_id = c.union_id)))
  WHERE ((msg.id = message_reactions.message_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum) AND ((c.type <> 'admin_only'::public.channel_type_enum) OR (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))) OR (EXISTS ( SELECT 1
   FROM (public.raid_messages rm
     JOIN public.union_members m ON ((m.union_id = rm.union_id)))
  WHERE ((rm.id = message_reactions.raid_message_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum) AND ((rm.room_type <> 'admin'::text) OR (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))))));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: mock_battles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mock_battles ENABLE ROW LEVEL SECURITY;

--
-- Name: mock_battles mock_battles_union_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY mock_battles_union_scope ON public.mock_battles TO authenticated USING ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = mock_battles.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum)))))) WITH CHECK ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = mock_battles.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum))))));


--
-- Name: nikkes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nikkes ENABLE ROW LEVEL SECURITY;

--
-- Name: profile_images; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profile_images ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subs_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_delete_own ON public.push_subscriptions FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: push_subscriptions push_subs_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_insert_own ON public.push_subscriptions FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: push_subscriptions push_subs_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_select_own ON public.push_subscriptions FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: push_subscriptions push_subs_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subs_update_own ON public.push_subscriptions FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: raid_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.raid_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: raid_messages raid_messages_season_lock_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY raid_messages_season_lock_delete ON public.raid_messages AS RESTRICTIVE FOR DELETE TO authenticated USING ((NOT public.is_raid_season_locked(union_id, season_name)));


--
-- Name: raid_messages raid_messages_season_lock_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY raid_messages_season_lock_insert ON public.raid_messages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK ((NOT public.is_raid_season_locked(union_id, season_name)));


--
-- Name: raid_messages raid_messages_season_lock_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY raid_messages_season_lock_update ON public.raid_messages AS RESTRICTIVE FOR UPDATE TO authenticated USING ((NOT public.is_raid_season_locked(union_id, season_name))) WITH CHECK ((NOT public.is_raid_season_locked(union_id, season_name)));


--
-- Name: raid_season_hp_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.raid_season_hp_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: raid_seasons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.raid_seasons ENABLE ROW LEVEL SECURITY;

--
-- Name: recommended_squads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.recommended_squads ENABLE ROW LEVEL SECURITY;

--
-- Name: recommended_squads recommended_squads_union_scope; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recommended_squads_union_scope ON public.recommended_squads TO authenticated USING ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = recommended_squads.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum)))))) WITH CHECK ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = recommended_squads.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum))))));


--
-- Name: reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

--
-- Name: union_settlement_members settlement_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settlement_members_select ON public.union_settlement_members FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.union_members um
  WHERE ((um.union_id = union_settlement_members.union_id) AND (um.user_id = auth.uid()) AND (um.join_status = 'approved'::public.join_status_enum)))));


--
-- Name: union_settlement_members settlement_members_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settlement_members_write ON public.union_settlement_members TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_settlement_members.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin())) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_settlement_members.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_settlement_status settlement_status_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settlement_status_select ON public.union_settlement_status FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.union_members um
  WHERE ((um.union_id = union_settlement_status.union_id) AND (um.user_id = auth.uid()) AND (um.join_status = 'approved'::public.join_status_enum)))));


--
-- Name: union_settlement_status settlement_status_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settlement_status_write ON public.union_settlement_status TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_settlement_status.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin())) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_settlement_status.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: site_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: site_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.site_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: site_notices site_notices_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY site_notices_admin_write ON public.site_notices USING (public.is_site_admin()) WITH CHECK (public.is_site_admin());


--
-- Name: site_notices site_notices_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY site_notices_select ON public.site_notices FOR SELECT USING ((auth.uid() IS NOT NULL));


--
-- Name: uid_change_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.uid_change_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: union_boss_memos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_boss_memos ENABLE ROW LEVEL SECURITY;

--
-- Name: union_join_passphrases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_join_passphrases ENABLE ROW LEVEL SECURITY;

--
-- Name: union_member_note_fields; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_member_note_fields ENABLE ROW LEVEL SECURITY;

--
-- Name: union_member_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_member_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: union_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_members ENABLE ROW LEVEL SECURITY;

--
-- Name: union_members union_members_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY union_members_insert ON public.union_members FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_site_admin() AS is_site_admin) OR ((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE(join_status, 'pending'::public.join_status_enum) = 'pending'::public.join_status_enum) AND ((COALESCE(role, 'member'::public.role_enum) = 'member'::public.role_enum) OR ((role = 'admin'::public.role_enum) AND (EXISTS ( SELECT 1
   FROM public.unions u
  WHERE ((u.id = union_members.union_id) AND (u.owner_id = ( SELECT auth.uid() AS uid))))))))));


--
-- Name: union_members union_members_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY union_members_select ON public.union_members FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR ((join_status = 'approved'::public.join_status_enum) AND (union_id IN ( SELECT public.my_approved_union_ids() AS my_approved_union_ids))) OR (union_id IN ( SELECT public.my_managed_union_ids() AS my_managed_union_ids))));


--
-- Name: union_nickname_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_nickname_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: union_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: union_notices union_notices_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY union_notices_admin_write ON public.union_notices USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_notices.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin())) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_notices.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_notices union_notices_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY union_notices_select ON public.union_notices FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_notices.union_id) AND (m.user_id = auth.uid()) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_raid_season_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_raid_season_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: union_raid_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_raid_status ENABLE ROW LEVEL SECURITY;

--
-- Name: union_raid_status union_raid_status_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY union_raid_status_insert ON public.union_raid_status FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_status.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum))))));


--
-- Name: union_raid_status union_raid_status_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY union_raid_status_select ON public.union_raid_status FOR SELECT TO authenticated USING ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_status.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum))))));


--
-- Name: union_raid_status union_raid_status_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY union_raid_status_update ON public.union_raid_status FOR UPDATE TO authenticated USING ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_status.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum)))))) WITH CHECK ((( SELECT public.is_site_admin() AS is_site_admin) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_status.union_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.join_status = 'approved'::public.join_status_enum))))));


--
-- Name: union_settlement_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_settlement_members ENABLE ROW LEVEL SECURITY;

--
-- Name: union_settlement_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.union_settlement_status ENABLE ROW LEVEL SECURITY;

--
-- Name: unions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.unions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_favorite_nikkes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_favorite_nikkes ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notice_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notice_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notice_reads user_notice_reads_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_notice_reads_own ON public.user_notice_reads USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: user_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: user_notifications user_notifications_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_notifications_insert ON public.user_notifications FOR INSERT TO authenticated WITH CHECK ((( SELECT public.is_site_admin() AS is_site_admin) OR ((EXISTS ( SELECT 1
   FROM public.union_members me
  WHERE ((me.union_id = user_notifications.union_id) AND (me.user_id = ( SELECT auth.uid() AS uid)) AND (me.join_status = 'approved'::public.join_status_enum)))) AND (EXISTS ( SELECT 1
   FROM public.union_members them
  WHERE ((them.union_id = user_notifications.union_id) AND (them.user_id = user_notifications.user_id)))))));


--
-- Name: user_site_notice_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_site_notice_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: user_site_notice_reads user_site_notice_reads_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_site_notice_reads_own ON public.user_site_notice_reads USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select ON public.users FOR SELECT TO authenticated USING (((id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE (m.user_id = users.id)))));


--
-- Name: FUNCTION apply_real_battle_damage(p_mock_battle_id uuid, p_real_damage bigint, p_is_last_hit boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.apply_real_battle_damage(p_mock_battle_id uuid, p_real_damage bigint, p_is_last_hit boolean) TO authenticated;


--
-- Name: FUNCTION get_nikke_usage_ranking(p_boss_name text, p_element text, p_season_count integer, p_min_decks integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_nikke_usage_ranking(p_boss_name text, p_element text, p_season_count integer, p_min_decks integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_nikke_usage_ranking(p_boss_name text, p_element text, p_season_count integer, p_min_decks integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_nikke_usage_ranking(p_boss_name text, p_element text, p_season_count integer, p_min_decks integer) TO service_role;


--
-- Name: FUNCTION is_raid_message_locked(p_raid_message_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_raid_message_locked(p_raid_message_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_raid_message_locked(p_raid_message_id uuid) TO authenticated;


--
-- Name: FUNCTION is_raid_season_locked(p_union_id uuid, p_season_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_raid_season_locked(p_union_id uuid, p_season_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_raid_season_locked(p_union_id uuid, p_season_name text) TO authenticated;


--
-- Name: FUNCTION is_uid_taken(p_uid text, p_exclude_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_uid_taken(p_uid text, p_exclude_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_uid_taken(p_uid text, p_exclude_user uuid) TO authenticated;


--
-- Name: FUNCTION my_approved_union_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_approved_union_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_approved_union_ids() TO authenticated;


--
-- Name: FUNCTION my_managed_union_ids(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_managed_union_ids() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_managed_union_ids() TO authenticated;


--
-- Name: FUNCTION raid_identity_key(p_union_id uuid, p_is_admin_written boolean, p_user_id uuid, p_manual_nickname text, p_synchro_level integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.raid_identity_key(p_union_id uuid, p_is_admin_written boolean, p_user_id uuid, p_manual_nickname text, p_synchro_level integer) FROM PUBLIC;


--
-- Name: FUNCTION revert_real_battle_damage(p_mock_battle_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.revert_real_battle_damage(p_mock_battle_id uuid) TO authenticated;


--
-- Name: FUNCTION update_daily_statistics(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.update_daily_statistics() FROM PUBLIC;
GRANT ALL ON FUNCTION public.update_daily_statistics() TO authenticated;


--
-- Name: FUNCTION verify_union_passphrase(p_union_id uuid, p_passphrase text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_union_passphrase(p_union_id uuid, p_passphrase text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_union_passphrase(p_union_id uuid, p_passphrase text) TO authenticated;


--
-- PostgreSQL database dump complete
--




-- =============================================================================
-- 2. 회원가입 시 public.users 행 자동 생성 (auth 스키마 트리거)
-- =============================================================================
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =============================================================================
-- 3. Storage 버킷과 접근 정책
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('chat_images', 'chat_images', true, 10485760, '{image/webp,image/png,image/jpeg,image/gif}'::text[]),
  ('emoticon_images', 'emoticon_images', true, 5242880, '{image/webp,image/gif,image/png,image/jpeg}'::text[]),
  ('nikke_images', 'nikke_images', true, null, null)
on conflict (id) do nothing;

create policy chat_images_authenticated_insert on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'chat_images'::text) AND ((EXISTS ( SELECT 1
   FROM public.my_approved_union_ids() my_approved_union_ids(my_approved_union_ids))) OR ( SELECT public.is_site_admin() AS is_site_admin))));
create policy chat_images_public_read on storage.objects as permissive for select to public
  using ((bucket_id = 'chat_images'::text));
create policy emoticon_images_admin_delete on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'emoticon_images'::text) AND ( SELECT public.is_site_admin() AS is_site_admin)));
create policy emoticon_images_admin_insert on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'emoticon_images'::text) AND ( SELECT public.is_site_admin() AS is_site_admin)));
create policy emoticon_images_admin_select on storage.objects as permissive for select to authenticated
  using (((bucket_id = 'emoticon_images'::text) AND ( SELECT public.is_site_admin() AS is_site_admin)));
create policy emoticon_images_admin_update on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'emoticon_images'::text) AND ( SELECT public.is_site_admin() AS is_site_admin)))
  with check (((bucket_id = 'emoticon_images'::text) AND ( SELECT public.is_site_admin() AS is_site_admin)));
create policy nikke_images_admin_delete on storage.objects as permissive for delete to authenticated
  using (((bucket_id = 'nikke_images'::text) AND public.is_site_admin()));
create policy nikke_images_admin_insert on storage.objects as permissive for insert to authenticated
  with check (((bucket_id = 'nikke_images'::text) AND public.is_site_admin()));
create policy nikke_images_admin_update on storage.objects as permissive for update to authenticated
  using (((bucket_id = 'nikke_images'::text) AND public.is_site_admin()))
  with check (((bucket_id = 'nikke_images'::text) AND public.is_site_admin()));
create policy nikke_images_public_read on storage.objects as permissive for select to public
  using ((bucket_id = 'nikke_images'::text));


-- =============================================================================
-- 4. Realtime: 실시간 구독 대상 테이블
-- =============================================================================
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['channels', 'message_reactions', 'messages', 'mock_battles', 'raid_messages', 'recommended_squads', 'union_boss_memos', 'union_members', 'union_nickname_requests', 'union_raid_status', 'user_notifications', 'users'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;


-- =============================================================================
-- 5. 기본 설정값과 정기 작업
-- =============================================================================
insert into public.app_settings (key, value)
values ('chat_image_retention_days', '7'::jsonb)
on conflict (key) do nothing;

-- 일일 통계 스냅샷 (매일 23:59)
select cron.schedule(
  'daily-snapshot-job',
  '59 23 * * *',
  $job$ select public.update_daily_statistics(); $job$
);

-- 채팅 이미지 자동 정리(cleanup-chat-images 호출)는 시크릿이 필요하므로
-- supabase/migrations/20260810120000_environment_setup.sql 의 3-2 블록을 참고해 따로 등록한다.
