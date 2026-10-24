-- 단계/보스 클리어 시각 기록. 결산(및 보스별 상세)에서 각 단계/보스가 처치된 시점을 표시하기 위함.
-- 타수별 완료 시각은 mock_battles.completed_at 으로 이미 기록된다. 여기서는 단계/보스 클리어 시각만 추가한다.
alter table public.union_raid_status
  add column if not exists cleared_at timestamptz;

-- is_cleared 가 false→true 로 바뀌는 순간 자동으로 클리어 시각을 남긴다.
-- 프로덕션의 실댐 반영은 confirm_real_battle RPC 가 아니라 클라이언트가 union_raid_status 를
-- 직접 update 하므로(ApplyRealDamageModal 등), 개별 update 지점을 고치는 대신 트리거로 일괄 보장한다.
-- 되돌리기(막타 취소 등)로 true→false 가 되면 시각을 비운다.
create or replace function public.set_union_raid_status_cleared_at()
returns trigger
language plpgsql
as $$
begin
  if new.is_cleared and not coalesce(old.is_cleared, false) then
    new.cleared_at := now();
  elsif not new.is_cleared and coalesce(old.is_cleared, false) then
    new.cleared_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_union_raid_status_cleared_at on public.union_raid_status;
create trigger trg_union_raid_status_cleared_at
  before update on public.union_raid_status
  for each row
  execute function public.set_union_raid_status_cleared_at();
