-- 길드 멤버 관리용 커스텀 "비고" 컬럼 (관리자 전용 주석).
-- 요구 6-2: 관리자가 비고 칼럼의 이름과 개수를 원할 때 추가할 수 있어야 한다.
-- 가입 일시(6-1)는 기존 union_members.created_at 을 그대로 사용하므로 별도 컬럼을 만들지 않는다.
--
-- 비고 값은 프라이버시상 공개 테이블(union_members: "Anyone can view" SELECT)에 두지 않고
-- 관리자만 읽고 쓸 수 있는 별도 테이블에 보관한다.

-- 길드별 비고 컬럼 정의(이름/순서).
create table if not exists public.union_member_note_fields (
  id uuid default gen_random_uuid() primary key,
  union_id uuid not null references public.unions(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists union_member_note_fields_union_idx
  on public.union_member_note_fields (union_id);

-- 멤버별 비고 값: notes = { "<field_id>": "<값>" }. 멤버당 1행.
create table if not exists public.union_member_notes (
  member_id uuid not null primary key references public.union_members(id) on delete cascade,
  notes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.union_member_note_fields enable row level security;
alter table public.union_member_notes enable row level security;

-- 정의/값 모두 해당 길드의 관리자/부관리자(승인) 또는 사이트 관리자만 접근.
create policy "member_note_fields_all" on public.union_member_note_fields
  for all to authenticated using (
    (exists (
      select 1 from public.union_members m
      where m.union_id = union_member_note_fields.union_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'sub_admin')
        and m.join_status = 'approved'
    )) or public.is_site_admin()
  ) with check (
    (exists (
      select 1 from public.union_members m
      where m.union_id = union_member_note_fields.union_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'sub_admin')
        and m.join_status = 'approved'
    )) or public.is_site_admin()
  );

create policy "member_notes_all" on public.union_member_notes
  for all to authenticated using (
    (exists (
      select 1
      from public.union_members target
      join public.union_members me on me.union_id = target.union_id
      where target.id = union_member_notes.member_id
        and me.user_id = auth.uid()
        and me.role in ('admin', 'sub_admin')
        and me.join_status = 'approved'
    )) or public.is_site_admin()
  ) with check (
    (exists (
      select 1
      from public.union_members target
      join public.union_members me on me.union_id = target.union_id
      where target.id = union_member_notes.member_id
        and me.user_id = auth.uid()
        and me.role in ('admin', 'sub_admin')
        and me.join_status = 'approved'
    )) or public.is_site_admin()
  );
