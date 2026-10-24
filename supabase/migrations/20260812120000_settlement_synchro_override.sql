-- 결산 멤버 행에 synchro_override 를 추가한다.
--
-- 배경: 이 시즌의 싱크로(union_settlement_members.synchro_level)는 '실전 타수의 싱크로 →
-- 프로필 싱크로' 순으로 파생되고 결산 확정 시 스냅샷으로 얼린다. 유저가 레벨을 갱신하지 않은
-- 채 시즌이 넘어가면 값이 틀어지는데, 지금까지는 DB를 직접 고치는 방법밖에 없었다.
--
-- synchro_override 는 관리자가 결산 페이지에서 직접 넣는 수기 값이다.
--  - null   → 앱이 파생값(실전 타수/프로필/확정 스냅샷)을 그대로 쓴다
--  - 값 있음 → 표시·성장 계산·다음 시즌 '지난 레벨' 모두 이 값을 우선한다
-- 재확정(스냅샷 갱신) 시에도 이 값은 파생값으로 덮이지 않는다.
-- (prev_synchro_level 이 '지난 레벨' 수기 덮어쓰기인 것과 같은 규칙)
alter table public.union_settlement_members
  add column if not exists synchro_override integer;
