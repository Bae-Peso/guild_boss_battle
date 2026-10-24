-- 20260810130000_rls_scope_boss_battle_tables.sql 적용 후속 2건.
--   1. 중복 인덱스 제거 (앞 마이그레이션이 만든 것)
--   2. recommended_squads 를 같은 방식으로 길드 스코프화 (같은 문제가 남아 있었음)
-- 두 건 모두 소규모라 한 파일로 묶는다. 적용 후 schema.sql 을 다시 덤프하면 최신 상태가 된다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 중복 인덱스 제거
-- ─────────────────────────────────────────────────────────────────────────────
-- union_raid_status 에는 이미 다음 유니크 제약이 있었다.
--   uq_union_raid_status_union_boss_stage UNIQUE (union_id, global_boss_id, stage_level)
--
-- 이 제약이 만드는 인덱스의 선두 컬럼이 union_id 이므로 `where union_id = ?` 조회는
-- 이미 leftmost prefix 로 처리된다. (union_id) 단독 인덱스는 중복이며 쓰기 비용만 늘린다.
--
-- (앞선 조사에서 `CREATE INDEX` 구문만 확인하느라 ADD CONSTRAINT ... UNIQUE 형태를 놓쳤다.
--  이 스키마에는 유니크 제약이 13개 있으므로 인덱스를 볼 땐 둘 다 확인해야 한다.)
--
-- global_boss_id 인덱스는 유지한다 — 유니크 제약의 선두 컬럼이 아니라서
-- global_boss_id 단독 조회/조인에는 쓰이지 못한다.
drop index if exists public.union_raid_status_union_idx;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. recommended_squads — 전역 개방 → 길드 스코프
-- ─────────────────────────────────────────────────────────────────────────────
-- mock_battles 와 완전히 같은 문제였다. 길드별 추천 스쿼드인데 CRUD 4개가 모두
-- `TO authenticated USING (true)` 여서, 로그인만 하면 타 길드의 추천 덱을 읽고
-- 수정·삭제할 수 있었다.
--
-- ※ 함께 남아 있는 다른 "Allow select for all" 정책들(global_raid_bosses,
--   raid_season_hp_settings, raid_seasons)은 손대지 않는다. 셋 다 전 길드가 공유하는
--   시즌 마스터 데이터이고 SELECT 만 열려 있으며, 쓰기는 이미 is_site_admin() 으로
--   막혀 있어 현재 상태가 의도된 설계다.
--
-- 코드 검토:
--   * 쓰기 MockBattleDashboard.jsx:388(insert) / :384(update) — payload 에
--     `union_id: guild.id` 포함 → WITH CHECK 통과. :409(delete) 는 `.eq('id', ...)` 단독이나
--     USING 이 스코프를 걸어준다.
--   * 읽기 MockBattleDashboard.jsx:180, MockBattleUploadModal.jsx:148 — 둘 다
--     `.eq('union_id', guild.id)` 로 이미 필터링.
--   * 관리자 백오피스는 이 테이블을 조회하지 않는다.

drop policy if exists "Allow select for all" on public.recommended_squads;
drop policy if exists "Allow insert for all" on public.recommended_squads;
drop policy if exists "Allow update for all" on public.recommended_squads;
drop policy if exists "Allow delete for all" on public.recommended_squads;

drop policy if exists "recommended_squads_union_scope" on public.recommended_squads;
create policy "recommended_squads_union_scope" on public.recommended_squads
  for all to authenticated
  using (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = recommended_squads.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  )
  with check (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = recommended_squads.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  );

-- Realtime: 앱이 recommended_squads 를 구독하므로, DELETE 이벤트에서도 새 SELECT 정책을
-- 평가할 수 있도록 변경 전 행 전체를 WAL 에 남긴다. (union_raid_status 와 동일한 이유)
alter table public.recommended_squads replica identity full;

-- 조회 패턴: `.eq('union_id', ...)` + 시즌/보스 필터
create index if not exists recommended_squads_union_season_boss_idx
  on public.recommended_squads (union_id, season_name, boss_number);


-- ─────────────────────────────────────────────────────────────────────────────
-- 부록. 적용 후 검증
-- ─────────────────────────────────────────────────────────────────────────────
--   -- USING(true) 가 남은 테이블 (기대: global_raid_bosses / raid_season_hp_settings /
--   --                              raid_seasons 의 SELECT 3건만)
--   select tablename, cmd, policyname from pg_policies
--    where schemaname='public' and qual='true' order by tablename, cmd;
--
--   -- 중복 인덱스가 사라졌는지 (기대: union_raid_status_union_idx 없음)
--   select indexname from pg_indexes
--    where schemaname='public' and tablename='union_raid_status' order by indexname;
