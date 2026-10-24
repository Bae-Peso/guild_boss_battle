-- 개인정보 공개 범위 축소 + 길드장 위임 버그 수정. (보안 점검 후속 3차, 2026-10-14)
--
-- ── 배경 ────────────────────────────────────────────────────────────────────
-- users / union_members 의 SELECT 가 `USING (true)` 이고 역할 제한도 없어서, 로그인하지 않은
-- 사람도 전체 유저의 인게임 UID·차단 사유·가입 대기 UID·상태메시지를 한 번에 긁어갈 수 있었다.
--
-- ── 새 범위 ─────────────────────────────────────────────────────────────────
-- union_members: 본인 행 + 내가 '승인'된 길드의 승인 멤버 행.
--                관리자(admin/sub_admin)는 자기 길드의 대기·차단 행까지(가입 신청/차단 목록 화면).
-- users        : 본인 + 위 범위로 보이는 union_members 에 등장하는 유저.
-- 둘 다 로그인 유저(authenticated)만. 사이트 관리자는 기존 bypass 정책으로 전부 본다.
--
-- 화면의 읽기 경로를 전수 조사했다. union_members 조회는 모두 `user_id = 본인` 이거나
-- `union_id = 내 길드` 이고(Lobby/MyPage/App/NoticeBanner/Workspace*/Settlement*/GuildSettings),
-- users 조회는 본인 행, 길드 멤버 조인(users(...)), 그리고 UID 중복 확인 4곳이다.
-- UID 중복 확인은 남의 행을 uid 로 찾아야 해서 새 범위에서는 동작하지 않으므로
-- is_uid_taken() RPC 로 바꾼다(존재 여부만 돌려주고 누구인지는 알려주지 않는다).
--
-- ── 재귀 회피 ───────────────────────────────────────────────────────────────
-- union_members 정책이 union_members 를 다시 읽으면 무한 재귀가 나므로, "내 길드 목록"은
-- RLS 를 우회하는 SECURITY DEFINER 헬퍼로 구한다. (20260810130000 §5-d 에서 예고한 방식)
-- 다른 테이블 정책들의 `exists (select 1 from union_members m where m.user_id = auth.uid() ...)`
-- 는 본인 행만 읽으므로 새 범위에서도 결과가 같다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 헬퍼
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.my_approved_union_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select union_id from union_members
  where user_id = auth.uid() and join_status = 'approved';
$$;

create or replace function public.my_managed_union_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select union_id from union_members
  where user_id = auth.uid()
    and join_status = 'approved'
    and role = any (array['admin', 'sub_admin']::role_enum[]);
$$;

revoke all on function public.my_approved_union_ids() from public, anon;
revoke all on function public.my_managed_union_ids() from public, anon;
grant execute on function public.my_approved_union_ids() to authenticated;
grant execute on function public.my_managed_union_ids() to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. union_members SELECT
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "Anyone can view union members" on public.union_members;
drop policy if exists "Users can view members" on public.union_members;
drop policy if exists "union_members_select" on public.union_members;
create policy "union_members_select" on public.union_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (join_status = 'approved' and union_id in (select public.my_approved_union_ids()))
    or union_id in (select public.my_managed_union_ids())
  );


-- 같은 테이블을 서브쿼리로 다시 읽던 UPDATE/DELETE 정책도 헬퍼로 바꾼다. 서브쿼리 속 union_members 에
-- 위 SELECT 정책(자체 서브쿼리 포함)이 다시 붙으면 Postgres 가 42P17 무한 재귀로 거부한다.
-- 조건은 기존과 같다: 승인된 admin/sub_admin 이거나 사이트 관리자, DELETE 는 차단되지 않은 본인 탈퇴 포함.
drop policy if exists "Union admins can manage members" on public.union_members;
create policy "Union admins can manage members" on public.union_members
  for update
  using (
    union_id in (select public.my_managed_union_ids())
    or (select public.is_site_admin())
  );

drop policy if exists "Union admins can delete members" on public.union_members;
create policy "Union admins can delete members" on public.union_members
  for delete
  using (
    (user_id = (select auth.uid()) and join_status <> 'banned')
    or union_id in (select public.my_managed_union_ids())
    or (select public.is_site_admin())
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. users SELECT
-- ─────────────────────────────────────────────────────────────────────────────
-- 서브쿼리의 union_members 에도 위 정책이 그대로 적용되므로, "내가 볼 수 있는 멤버"인 유저만 보인다.
drop policy if exists "Users are viewable by everyone" on public.users;
drop policy if exists "users_select" on public.users;
create policy "users_select" on public.users
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (select 1 from public.union_members m where m.user_id = users.id)
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. UID 중복 확인 RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- 호출 경로: Lobby.jsx(가입/개설 신청), MyPage.jsx(UID 변경 신청) → p_exclude_user 생략(본인 제외)
--            GuildSettings.jsx(가입 승인) → 신청자 id 를 넘겨 그 사람을 제외
create or replace function public.is_uid_taken(p_uid text, p_exclude_user uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from users
    where uid = p_uid
      and id is distinct from coalesce(p_exclude_user, auth.uid())
  );
$$;

revoke all on function public.is_uid_taken(text, uuid) from public, anon;
grant execute on function public.is_uid_taken(text, uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. 길드장 위임 버그 수정
-- ─────────────────────────────────────────────────────────────────────────────
-- "Guild owner can update guild" 에 WITH CHECK 가 없어 USING(owner_id = 나)가 새 행에도 적용됐다.
-- 그래서 owner_id 를 다른 사람으로 바꾸는 위임(GuildSettings.jsx handleRoleChange)이 항상 실패했다.
-- 새 소유자는 그 길드의 승인 멤버여야 한다는 조건으로 바꾼다. (승인 상태 변경은
-- 20261014120000 의 trg_guard_unions_status 가 계속 막는다)
drop policy if exists "Union owner can update union" on public.unions;
create policy "Union owner can update union" on public.unions
  for update
  using (owner_id = (select auth.uid()) or (select public.is_site_admin()))
  with check (
    (select public.is_site_admin())
    or owner_id = (select auth.uid())
    or exists (
      select 1 from public.union_members m
      where m.union_id = unions.id
        and m.user_id = unions.owner_id
        and m.join_status = 'approved'
    )
  );
