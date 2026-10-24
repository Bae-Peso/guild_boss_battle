-- 모의전 기록에 유저 메모 컬럼 추가.
-- 관리자 추천 덱(recommended_squads.memo)과 동일하게, 모의전 기록 작성 시
-- 자유 텍스트 메모를 남기고 기록 표에서 📝 배지(SquadMemoBadge)로 표시하기 위한 용도.
alter table public.mock_battles
  add column if not exists memo text;
