-- 길드 보스전 결산(Settlement) 저장소.
-- 결산 페이지는 대부분의 데이터를 mock_battles/union_raid_status 에서 실시간 파생하지만,
-- 시즌 종료 후 변하지 않아야 하는 값(싱크로 레벨)과 관리자 결산 비고는 아래 테이블에 얼려/보관한다.

-- 시즌별 결산 확정 상태. 확정(finalize) 시 스냅샷을 얼리고 일반 유저 열람을 개방한다.
create table if not exists public.union_settlement_status (
  union_id uuid not null references public.unions(id) on delete cascade,
  season_name text not null references public.raid_seasons(name) on delete cascade,
  is_finalized boolean not null default false,
  finalized_at timestamptz,
  finalized_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (union_id, season_name)
);

-- 결산 멤버별 행: 확정 시 얼린 싱크로 레벨 + 관리자 결산 비고(상시 편집 가능).
-- member_key: 'user:<uuid>' (가입 멤버) 또는 'manual:<닉네임>' (관리자 수기 외부인).
-- synchro_level 은 확정 전엔 null(앱에서 라이브 파생), 확정 시 얼린 값을 채운다.
create table if not exists public.union_settlement_members (
  id uuid default gen_random_uuid() primary key,
  union_id uuid not null references public.unions(id) on delete cascade,
  season_name text not null references public.raid_seasons(name) on delete cascade,
  member_key text not null,
  user_id uuid references public.users(id) on delete set null,
  manual_nickname text,
  synchro_level integer,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (union_id, season_name, member_key)
);

create index if not exists union_settlement_members_scope_idx
  on public.union_settlement_members (union_id, season_name);

alter table public.union_settlement_status enable row level security;
alter table public.union_settlement_members enable row level security;

-- 읽기: 해당 길드의 승인된 멤버. (확정 후 공개 전환은 앱 레벨 게이팅으로 처리)
-- 쓰기: 해당 길드의 관리자/부관리자(승인) 또는 사이트 관리자.
create policy "settlement_status_select" on public.union_settlement_status
  for select to authenticated using (
    exists (
      select 1 from public.union_members um
      where um.union_id = union_settlement_status.union_id
        and um.user_id = auth.uid()
        and um.join_status = 'approved'
    )
  );

create policy "settlement_status_write" on public.union_settlement_status
  for all to authenticated using (
    (exists (
      select 1 from public.union_members m
      where m.union_id = union_settlement_status.union_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'sub_admin')
        and m.join_status = 'approved'
    )) or public.is_site_admin()
  ) with check (
    (exists (
      select 1 from public.union_members m
      where m.union_id = union_settlement_status.union_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'sub_admin')
        and m.join_status = 'approved'
    )) or public.is_site_admin()
  );

create policy "settlement_members_select" on public.union_settlement_members
  for select to authenticated using (
    exists (
      select 1 from public.union_members um
      where um.union_id = union_settlement_members.union_id
        and um.user_id = auth.uid()
        and um.join_status = 'approved'
    )
  );

create policy "settlement_members_write" on public.union_settlement_members
  for all to authenticated using (
    (exists (
      select 1 from public.union_members m
      where m.union_id = union_settlement_members.union_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'sub_admin')
        and m.join_status = 'approved'
    )) or public.is_site_admin()
  ) with check (
    (exists (
      select 1 from public.union_members m
      where m.union_id = union_settlement_members.union_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'sub_admin')
        and m.join_status = 'approved'
    )) or public.is_site_admin()
  );
