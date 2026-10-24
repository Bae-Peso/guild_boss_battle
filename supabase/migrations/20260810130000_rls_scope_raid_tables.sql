-- 보스전 핵심 테이블(mock_battles, union_raid_status)의 RLS를 길드 스코프로 좁히고,
-- 정책 평가 성능과 인덱스를 함께 개선한다.
--
-- ── 배경 ────────────────────────────────────────────────────────────────────
-- 두 테이블에는 `TO authenticated USING (true)` 정책이 걸려 있었다. 이 앱은 브라우저가
-- DB에 직접 접속하고 anon 키는 설계상 JS 번들에 공개되므로, 로그인만 하면 누구나 콘솔에서
-- 타 길드의 보스전 기록을 읽고 수정·삭제할 수 있는 상태였다.
-- React 쪽 isManager(role) 검사는 화면만 가릴 뿐 DB를 막지 못한다.
--
-- union_raid_status 에는 올바른 스코프 정책("Members can update ...")이 이미 있었지만,
-- permissive 정책은 OR로 합쳐지므로 USING(true) 하나가 그것들을 전부 무력화하고 있었다.
--
-- ── 설계 원칙 ───────────────────────────────────────────────────────────────
-- **길드 간 경계만 세우고, 길드 내부 동작은 지금과 100% 동일하게 유지한다.**
-- (예: "일반 멤버도 같은 길드의 남의 타수를 지울 수 있다"는 현재 동작을 여기서 바꾸지 않는다.
--  그건 UI 변경을 동반하는 별개 작업이라, 함께 하면 회귀 시 원인을 분리할 수 없다. §5 참고.)
-- 덕분에 적용 후 검증이 "타 길드 차단됐나 + 내 길드 화면 정상인가" 두 가지로 끝난다.
--
-- ── 안전성 검토 결과 (코드 전수 조사) ───────────────────────────────────────
--  * 쓰기: MockBattleDashboard.jsx:326, MockBattleUploadModal.jsx:308 의 INSERT payload가
--    모두 `union_id: guild.id` 를 포함 → WITH CHECK 통과.
--    UPDATE/DELETE 는 `.eq('id', ...)` 단독이지만 USING 이 스코프를 걸어주므로 자기 길드
--    행에만 적용된다(타 길드 행은 에러가 아니라 0 rows affected).
--  * 읽기: 전부 `.eq('union_id', guild.id)` 로 이미 필터링되어 있다.
--    유일한 예외가 MockBattleUploadModal.jsx:288 의 3타 카운트 쿼리(union_id 필터 없음)인데,
--    스코프가 걸리면 오히려 타 길드의 동명이인 수기 기록이 섞이던 잠재 버그가 교정된다.
--  * 관리자 백오피스(src/pages/admin/*)는 이 두 테이블을 조회하지 않는다. 그래도 다른
--    테이블들과의 일관성을 위해 is_site_admin() 우회는 남겨둔다.
--  * apply_real_battle_damage / revert_real_battle_damage 는 SECURITY DEFINER 라 RLS를
--    우회한다 → 실전 적용·되돌리기는 정책과 무관하게 그대로 동작한다.
--  * 재귀 위험 없음: 정책이 참조하는 union_members 의 SELECT 정책이 USING(true) 라
--    정책 평가 중 다시 RLS가 걸리지 않는다.
--    ⚠️ 훗날 union_members 의 SELECT 를 좁힌다면, 아래 EXISTS 들은 무한 재귀를 피하기 위해
--       SECURITY DEFINER 헬퍼 함수 호출로 바꿔야 한다.
--
-- ── 성능 관점 ───────────────────────────────────────────────────────────────
--  * `auth.uid()` 를 맨 호출이 아니라 `(select auth.uid())` 로 감싼다. 스칼라 서브쿼리는
--    InitPlan 으로 쿼리당 1회만 평가되지만, 맨 호출은 행마다 재평가된다.
--  * 판정을 SECURITY DEFINER 헬퍼 함수로 빼지 않고 EXISTS 를 인라인으로 둔다.
--    SECURITY DEFINER 함수는 플래너가 인라인 전개할 수 없어 행마다 함수 호출이 되지만,
--    인라인 EXISTS 는 union_members 와의 semi-join 으로 변환될 수 있다.
--  * EXISTS 조회는 union_members 의 UNIQUE (union_id, user_id) 인덱스를 그대로 탄다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. mock_battles — 전역 개방 → 길드 스코프
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Allow select for all" on public.mock_battles;
drop policy if exists "Allow insert for all" on public.mock_battles;
drop policy if exists "Allow update for all" on public.mock_battles;
drop policy if exists "Allow delete for all" on public.mock_battles;

-- FOR ALL 단일 정책 = 기존 4개와 동일한 범위를, 길드 경계 안에서만 허용.
drop policy if exists "mock_battles_union_scope" on public.mock_battles;
create policy "mock_battles_union_scope" on public.mock_battles
  for all to authenticated
  using (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = mock_battles.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  )
  with check (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = mock_battles.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. union_raid_status — 느슨한 정책 제거 + 기존 정책 재작성
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Allow select for all" on public.union_raid_status;
drop policy if exists "Allow update for all" on public.union_raid_status;

-- SELECT: 기존엔 USING(true) 뿐이라 스코프 버전이 아예 없었다 → 신규 작성
drop policy if exists "union_raid_status_select" on public.union_raid_status;
create policy "union_raid_status_select" on public.union_raid_status
  for select to authenticated
  using (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = union_raid_status.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  );

-- INSERT/UPDATE: 기존 "Members can ..." 정책과 **허용 범위는 완전히 동일**하고,
-- auth.uid() → (select auth.uid()) 로 감싼 것과 site admin 우회를 더한 것만 다르다.
drop policy if exists "Members can insert union_raid_status" on public.union_raid_status;
drop policy if exists "union_raid_status_insert" on public.union_raid_status;
create policy "union_raid_status_insert" on public.union_raid_status
  for insert to authenticated
  with check (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = union_raid_status.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  );

drop policy if exists "Members can update union_raid_status" on public.union_raid_status;
drop policy if exists "union_raid_status_update" on public.union_raid_status;
create policy "union_raid_status_update" on public.union_raid_status
  for update to authenticated
  using (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = union_raid_status.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  )
  with check (
    (select public.is_site_admin())
    or exists (
      select 1 from public.union_members m
      where m.union_id = union_raid_status.union_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
    )
  );

-- DELETE 는 기존 두 정책("Admins can delete ...", "Guild admins can delete ...")을 그대로 둔다.
-- 이미 관리자 한정이라 충분히 좁고, 손대면 검증 범위만 넓어진다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Realtime — DELETE 이벤트에서도 정책을 평가할 수 있게
-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime 은 구독자별로 SELECT 정책을 평가해 이벤트 전달 여부를 정한다.
-- REPLICA IDENTITY 가 기본(primary key)이면 DELETE 이벤트에 PK만 실려 union_id 를 읽을 수 없고,
-- 새 스코프 정책을 평가하지 못해 이벤트가 조용히 누락된다.
-- (지금까지는 SELECT 가 USING(true) 라 평가가 무조건 통과해서 문제가 드러나지 않았다.)
--
-- mock_battles 는 이미 FULL 이므로 union_raid_status 만 맞춘다.
-- 비용: UPDATE 시 WAL 에 변경 전 행 전체가 기록되지만, (보스 5 × 단계) × 길드 수 규모에
-- 컬럼 7개짜리 작은 행이라 무시할 수준이다.
alter table public.union_raid_status replica identity full;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 인덱스 — 두 테이블 모두 PK 외 인덱스가 전무했다
-- ─────────────────────────────────────────────────────────────────────────────
-- 앱의 실제 쿼리 패턴에서 역산했다. RLS가 union_id 를 참조하게 되면서 중요도가 더 올라간다.
-- ※ CONCURRENTLY 는 트랜잭션 안에서 쓸 수 없어 제외했다. 두 테이블 모두 소규모라
--   생성 중 짧은 쓰기 잠금은 체감되지 않는다.

-- BossBattleDashboard / GuildBossBattleStatus / Settlement: union_id + status 조합 조회
create index if not exists mock_battles_union_status_idx
  on public.mock_battles (union_id, status);

-- `.in('boss_status_id', statusIds)` — 거의 모든 조회에 등장
create index if not exists mock_battles_boss_status_idx
  on public.mock_battles (boss_status_id);

-- 시즌 3타 캡 체크 (apply_real_battle_damage 내부 + 업로드 모달).
-- 본인 기록/수기 기록 경로가 갈리므로 부분 인덱스로 나눈다.
create index if not exists mock_battles_union_user_idx
  on public.mock_battles (union_id, user_id) where is_admin_written = false;

create index if not exists mock_battles_union_manual_idx
  on public.mock_battles (union_id, manual_nickname) where is_admin_written = true;

-- union_raid_status: union_id 단독 조회 + global_boss_id 조인
create index if not exists union_raid_status_union_idx
  on public.union_raid_status (union_id);

create index if not exists union_raid_status_boss_idx
  on public.union_raid_status (global_boss_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 후속 과제 (의도적으로 이 마이그레이션에서 제외)
-- ─────────────────────────────────────────────────────────────────────────────
-- (a) 길드 내부 권한 세분화: 지금은 승인 멤버 누구나 같은 길드의 타수를 지울 수 있다.
--     "본인 기록 또는 관리자만"으로 좁히려면 UI 동작 변경이 함께 필요하다.
-- (b) 나머지 정책 80여 개의 auth.uid() → (select auth.uid()) 일괄 전환.
--     의미는 동일하고 성능만 개선되지만, 한 번에 바꾸면 회귀 시 원인 추적이 어렵다.
--     테이블 단위로 나눠 진행 권장.
-- (c) messages / raid_messages 등 채팅 테이블 정책도 동일 관점의 점검 필요.
-- (d) union_members 의 SELECT 가 USING(true) 라 전 사이트 멤버 명단이 공개된다.
--     좁힐 경우 위 §1·2 의 EXISTS 를 SECURITY DEFINER 헬퍼로 교체해야 재귀를 피할 수 있다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 부록 A. 적용 후 검증 쿼리
-- ─────────────────────────────────────────────────────────────────────────────
--   -- 1) USING(true) 정책이 남아있지 않은지 (기대: 0행)
--   select tablename, policyname from pg_policies
--    where schemaname='public' and tablename in ('mock_battles','union_raid_status')
--      and qual = 'true';
--
--   -- 2) 최종 정책 목록
--   select tablename, policyname, cmd from pg_policies
--    where schemaname='public' and tablename in ('mock_battles','union_raid_status')
--    order by tablename, cmd, policyname;
--
--   -- 3) 인덱스 확인 (기대: 신규 6개 + PK)
--   select tablename, indexname from pg_indexes
--    where schemaname='public' and tablename in ('mock_battles','union_raid_status')
--    order by tablename, indexname;
--
--   -- 4) 인덱스를 실제로 타는지 (<guild-uuid> 치환)
--   explain analyze
--   select * from public.mock_battles where union_id='<guild-uuid>' and status='completed';
