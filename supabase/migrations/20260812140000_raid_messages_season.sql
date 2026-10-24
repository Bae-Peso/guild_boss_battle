-- 지휘 채팅을 시즌 단위로 분리한다.
--
-- 지휘 채팅은 그 시즌의 보스전을 굴리는 대화라, 시즌이 바뀌면 지난 대화는 함께 넘어가야 한다.
-- 메시지에 시즌을 물려 두면 지난 시즌 지휘방을 그대로 열람할 수 있고, 대화 상대의 그 시즌 보스전
-- 기록(mock_battles)도 같은 시즌 기준으로 이어서 보여줄 수 있다.
--
-- season_name은 nullable로 둔다: raid_seasons가 아직 하나도 없는 상태에서 남은 메시지는
-- 물릴 시즌이 없기 때문. (화면에서는 시즌이 정해져야만 지휘 채팅을 쓸 수 있다)

alter table public.raid_messages
  add column if not exists season_name text
  references public.raid_seasons(name) on update cascade on delete set null;

-- 기존 메시지 백필: 작성 시각(KST 기준)에 이미 시작한 시즌 중 가장 최근 시즌.
update public.raid_messages m
set season_name = (
  select s.name
  from public.raid_seasons s
  where s.start_date <= (m.created_at at time zone 'Asia/Seoul')::date
  order by s.start_date desc
  limit 1
)
where m.season_name is null;

-- 첫 시즌 시작 전에 쌓인 메시지는 가장 이른 시즌으로 보낸다(어디에도 안 걸려 사라지지 않게).
update public.raid_messages m
set season_name = (select s.name from public.raid_seasons s order by s.start_date asc limit 1)
where m.season_name is null;

-- 채팅 조회는 항상 (길드, 시즌, 방) 조합으로 최근 100건을 읽는다.
create index if not exists idx_raid_messages_union_season_room
  on public.raid_messages (union_id, season_name, room_type, created_at desc);
