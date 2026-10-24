--
-- PostgreSQL database dump
--

\restrict nD5a3JU5bwwqc6ETsk1vsoPg4yOpDSvrQWBj9h6STQlgtZxysHb62Uo7XJYdB7T

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
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

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


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


--
-- Name: delete_user_by_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_user_by_admin(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
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
    AS $$
DECLARE
    max_stage INTEGER;
    b_record RECORD;
    s_level INTEGER;
    hp BIGINT;
BEGIN
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
-- Name: is_site_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_site_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    AS $$
  select exists(select 1 from public.site_admins where user_id = auth.uid() and is_active = true);
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
-- Name: chat_read_state_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX chat_read_state_user_idx ON public.chat_read_state USING btree (user_id);


--
-- Name: idx_emoticons_pack_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_emoticons_pack_id ON public.emoticons USING btree (pack_id);


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

CREATE TRIGGER user_notifications AFTER INSERT ON public.user_notifications FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://<your-project-ref>.supabase.co/functions/v1/send-push', 'POST', '{"x-push-secret":"<REDACTED: Dashboard Database Webhook 설정 참고>"}', '{}', '5000');


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
   FROM public.union_members
  WHERE ((union_members.union_id = union_boss_memos.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))));


--
-- Name: union_notices Admins can manage union_notices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can manage union_notices" ON public.union_notices USING ((EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = union_notices.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))));


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
   FROM public.union_members
  WHERE ((union_members.union_id = union_nickname_requests.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))));


--
-- Name: profile_images Admins can update profile images; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update profile images" ON public.profile_images FOR UPDATE USING (public.is_site_admin()) WITH CHECK (public.is_site_admin());


--
-- Name: union_boss_memos Admins can update union_boss_memos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update union_boss_memos" ON public.union_boss_memos FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = union_boss_memos.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))));


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
-- Name: user_notifications Anyone can insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert notifications" ON public.user_notifications FOR INSERT WITH CHECK ((auth.role() = 'authenticated'::text));


--
-- Name: user_notifications Anyone can insert notifications (for mentions); Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert notifications (for mentions)" ON public.user_notifications FOR INSERT WITH CHECK (true);


--
-- Name: game_icons Anyone can read game_icons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read game_icons" ON public.game_icons FOR SELECT USING (true);


--
-- Name: union_raid_season_settings Anyone can read season settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read season settings" ON public.union_raid_season_settings FOR SELECT TO authenticated USING (true);


--
-- Name: union_notices Anyone can read union_notices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can read union_notices" ON public.union_notices FOR SELECT USING (true);


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
-- Name: union_members Anyone can view guild members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view union members" ON public.union_members FOR SELECT USING (true);


--
-- Name: unions Anyone can view unions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view unions" ON public.unions FOR SELECT USING (true);


--
-- Name: audit_logs Authenticated users can insert audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK ((auth.uid() = actor_id));


--
-- Name: nikkes Enable all access for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable all access for authenticated users" ON public.nikkes USING ((auth.role() = 'authenticated'::text));


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
-- Name: raid_messages Members can update own bossBattle messages; Type: POLICY; Schema: public; Owner: -
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
-- Name: union_members Guild admins can delete members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can delete members" ON public.union_members FOR DELETE USING ((((user_id = auth.uid()) AND (join_status <> 'banned'::public.join_status_enum)) OR (EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_members.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_raid_status Guild admins can delete union_raid_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can delete union_raid_status" ON public.union_raid_status FOR DELETE TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_status.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: channels Guild admins can manage channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can manage channels" ON public.channels USING ((union_id IN ( SELECT union_members.union_id
   FROM public.union_members
  WHERE ((union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))));


--
-- Name: union_members Guild admins can manage members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins can manage members" ON public.union_members FOR UPDATE USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_members.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_raid_season_settings Guild admins manage season settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union admins manage season settings" ON public.union_raid_season_settings TO authenticated USING (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_season_settings.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin())) WITH CHECK (((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_raid_season_settings.union_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])) AND (m.join_status = 'approved'::public.join_status_enum)))) OR public.is_site_admin()));


--
-- Name: union_join_passphrases Guild managers manage join passphrase; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union managers manage join passphrase" ON public.union_join_passphrases USING ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_join_passphrases.union_id) AND (m.user_id = auth.uid()) AND (m.join_status = 'approved'::public.join_status_enum) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.union_members m
  WHERE ((m.union_id = union_join_passphrases.union_id) AND (m.user_id = auth.uid()) AND (m.join_status = 'approved'::public.join_status_enum) AND (m.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))));


--
-- Name: unions Guild owner can update guild; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Union owner can update union" ON public.unions FOR UPDATE USING (((owner_id = auth.uid()) OR public.is_site_admin()));


--
-- Name: users Users are viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users are viewable by everyone" ON public.users FOR SELECT USING (true);


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
-- Name: union_members Users can insert own membership; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own membership" ON public.union_members FOR INSERT WITH CHECK (((user_id = auth.uid()) OR public.is_site_admin()));


--
-- Name: union_nickname_requests Users can insert own nickname requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own nickname requests" ON public.union_nickname_requests FOR INSERT WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = union_nickname_requests.union_id) AND (union_members.user_id = auth.uid()))))));


--
-- Name: uid_change_requests Users can insert own uid requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own uid requests" ON public.uid_change_requests FOR INSERT WITH CHECK ((user_id = auth.uid()));


--
-- Name: unions Users can insert pending unions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert pending unions" ON public.unions FOR INSERT WITH CHECK ((auth.uid() = owner_id));


--
-- Name: raid_messages Users can insert bossBattle messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert raid messages" ON public.raid_messages FOR INSERT WITH CHECK (((union_id IN ( SELECT union_members.union_id
   FROM public.union_members
  WHERE ((union_members.user_id = auth.uid()) AND (union_members.join_status = 'approved'::public.join_status_enum)))) AND ((room_type = 'general'::text) OR ((room_type = 'admin'::text) AND (EXISTS ( SELECT 1
   FROM public.union_members
  WHERE ((union_members.union_id = raid_messages.union_id) AND (union_members.user_id = auth.uid()) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum])))))))));


--
-- Name: reports Users can insert reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert reports" ON public.reports FOR INSERT WITH CHECK ((auth.uid() = reporter_id));


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
-- Name: raid_messages Users can read guild bossBattle messages; Type: POLICY; Schema: public; Owner: -
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
-- Name: union_members Users can request to join; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can request to join" ON public.union_members FOR INSERT WITH CHECK ((auth.uid() = user_id));


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
-- Name: union_members Users can view members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view members" ON public.union_members FOR SELECT USING (true);


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
-- Name: channels Users can view guild channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view union channels" ON public.channels FOR SELECT USING (((union_id IN ( SELECT union_members.union_id
   FROM public.union_members
  WHERE ((union_members.user_id = auth.uid()) AND (union_members.join_status = 'approved'::public.join_status_enum)))) AND ((type <> 'admin_only'::public.channel_type_enum) OR (auth.uid() IN ( SELECT union_members.user_id
   FROM public.union_members
  WHERE ((union_members.union_id = channels.union_id) AND (union_members.role = ANY (ARRAY['admin'::public.role_enum, 'sub_admin'::public.role_enum]))))))));


--
-- Name: messages Users can view guild messages; Type: POLICY; Schema: public; Owner: -
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
-- PostgreSQL database dump complete
--

\unrestrict nD5a3JU5bwwqc6ETsk1vsoPg4yOpDSvrQWBj9h6STQlgtZxysHb62Uo7XJYdB7T

