-- 보스전 기록 잠금(union_raid_season_settings.is_locked)을 지휘 채팅에도 서버에서 적용한다.
--
-- 지금까지 잠금은 화면(지휘 현황판/모의전)에서만 확인했고, 지휘 채팅은 아예 확인하지 않았다.
-- 그래서 가장 최근 시즌을 잠가도 그 시즌 지휘방에 글쓰기·수정·삭제·반응이 그대로 됐다.
-- 잠긴 시즌의 지휘 채팅은 열람만 되게, 쓰기 경로를 모두 RESTRICTIVE 정책으로 막는다.
-- (RESTRICTIVE 는 기존 허용 정책과 AND 로 묶이므로 기존 정책은 건드리지 않는다)
--
-- 길드/시즌 삭제에 따른 FK cascade·set null 은 RLS 를 거치지 않으므로 영향이 없다.
-- 잠금을 풀면 다시 쓸 수 있다.

create or replace function public.is_raid_season_locked(p_union_id uuid, p_season_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select s.is_locked
    from public.union_raid_season_settings s
    where s.union_id = p_union_id
      and s.season_name = p_season_name
  ), false);
$$;

-- 반응(message_reactions)은 raid_message_id 만 들고 있어 메시지를 거쳐 시즌을 찾는다.
create or replace function public.is_raid_message_locked(p_raid_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select public.is_raid_season_locked(rm.union_id, rm.season_name)
    from public.raid_messages rm
    where rm.id = p_raid_message_id
  ), false);
$$;

revoke all on function public.is_raid_season_locked(uuid, text) from public, anon;
revoke all on function public.is_raid_message_locked(uuid) from public, anon;
grant execute on function public.is_raid_season_locked(uuid, text) to authenticated;
grant execute on function public.is_raid_message_locked(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- raid_messages — 잠긴 시즌에는 작성/수정/삭제(소프트 삭제는 update) 불가
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "raid_messages_season_lock_insert" on public.raid_messages;
create policy "raid_messages_season_lock_insert" on public.raid_messages
  as restrictive
  for insert to authenticated
  with check (not public.is_raid_season_locked(union_id, season_name));

drop policy if exists "raid_messages_season_lock_update" on public.raid_messages;
create policy "raid_messages_season_lock_update" on public.raid_messages
  as restrictive
  for update to authenticated
  using (not public.is_raid_season_locked(union_id, season_name))
  with check (not public.is_raid_season_locked(union_id, season_name));

drop policy if exists "raid_messages_season_lock_delete" on public.raid_messages;
create policy "raid_messages_season_lock_delete" on public.raid_messages
  as restrictive
  for delete to authenticated
  using (not public.is_raid_season_locked(union_id, season_name));


-- ─────────────────────────────────────────────────────────────────────────────
-- message_reactions — 잠긴 시즌 지휘 메시지에는 반응 추가/취소 불가 (일반 채팅 반응은 그대로)
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "message_reactions_season_lock_insert" on public.message_reactions;
create policy "message_reactions_season_lock_insert" on public.message_reactions
  as restrictive
  for insert to authenticated
  with check (raid_message_id is null or not public.is_raid_message_locked(raid_message_id));

drop policy if exists "message_reactions_season_lock_delete" on public.message_reactions;
create policy "message_reactions_season_lock_delete" on public.message_reactions
  as restrictive
  for delete to authenticated
  using (raid_message_id is null or not public.is_raid_message_locked(raid_message_id));
