-- 결산 멤버 행에 두 값을 추가한다.
-- 1) prev_synchro_level: '지난 레벨'을 관리자가 수기로 덮어쓸 수 있게 저장한다.
--    (null 이면 앱에서 직전 시즌 값으로 파생, 값이 있으면 그 값을 우선 사용)
-- 2) display_name: 결산 확정/저장 시점의 닉네임 스냅샷. 멤버가 탈퇴해 로스터에서
--    사라져도 결산 페이지에 닉네임이 영구히 남도록 하기 위한 용도.
alter table public.union_settlement_members
  add column if not exists prev_synchro_level integer,
  add column if not exists display_name text;
