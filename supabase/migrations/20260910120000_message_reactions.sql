-- 메시지 반응(이모지) — 일반 채팅(messages)과 지휘 채팅(raid_messages) 공용.
--
-- ── 한 테이블에 두 대상 ─────────────────────────────────────────────────────
-- 두 채팅은 메시지 테이블이 따로지만, 반응은 규칙(한 사람이 한 메시지에 한 이모지 하나,
-- 누가 눌렀는지 표시)이 완전히 같다. 테이블을 둘로 나누면 정책·인덱스·클라이언트 훅이
-- 통째로 두 벌이 되므로, nullable FK 두 개 + "정확히 하나만 채운다" 제약으로 합친다.
--
-- emoji 는 값(문자)을 그대로 저장한다. 지금 화면에 나오는 건 ✅ / ❤️ / ❌ 세 개뿐이지만
-- 목록은 클라이언트(src/lib/reactions.js)에만 두어, 종류를 늘릴 때 마이그레이션이 필요 없게 한다.
-- 대신 길이만 제한해 임의의 긴 문자열이 들어오는 것을 막는다.

create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete cascade,
  raid_message_id uuid references public.raid_messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null,
  created_at timestamp with time zone not null default now(),
  constraint message_reactions_one_target check ((message_id is null) <> (raid_message_id is null)),
  constraint message_reactions_emoji_len check (char_length(emoji) between 1 and 16)
);

-- 같은 사람이 같은 메시지에 같은 이모지를 두 번 달 수 없다(연타/중복 요청 방지).
-- 선두 컬럼이 대상 메시지라, 화면이 쓰는 `where message_id in (...)` 조회도 이 인덱스를 탄다.
create unique index if not exists message_reactions_msg_uniq
  on public.message_reactions (message_id, user_id, emoji) where message_id is not null;
create unique index if not exists message_reactions_raid_uniq
  on public.message_reactions (raid_message_id, user_id, emoji) where raid_message_id is not null;


-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — 원본 메시지를 볼 수 있는 사람만 그 메시지의 반응을 보고 달 수 있다.
-- ─────────────────────────────────────────────────────────────────────────────
-- 부모 테이블의 SELECT 정책을 그대로 옮겨 적는다(EXISTS 로 부모를 읽어 RLS에 맡기는 방식은
-- 정책 표현식 안에서의 RLS 적용 여부에 기대게 되어, 어긋나면 조용히 길드 경계가 열린다).
-- 즉 여기서 확인하는 것은 부모와 동일한 두 가지: 승인된 같은 길드 멤버인가,
-- 그리고 관리자 전용 방(채널 admin_only / 지휘 admin)이면 관리자인가.
alter table public.message_reactions enable row level security;

drop policy if exists "message_reactions_select" on public.message_reactions;
create policy "message_reactions_select" on public.message_reactions
  for select to authenticated
  using (
    (select public.is_site_admin())
    or exists (
      select 1
      from public.messages msg
      join public.channels c on c.id = msg.channel_id
      join public.union_members m on m.union_id = c.union_id
      where msg.id = message_reactions.message_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
        and (c.type <> 'admin_only' or m.role = any (array['admin', 'sub_admin']::public.role_enum[]))
    )
    or exists (
      select 1
      from public.raid_messages rm
      join public.union_members m on m.union_id = rm.union_id
      where rm.id = message_reactions.raid_message_id
        and m.user_id = (select auth.uid())
        and m.join_status = 'approved'
        and (rm.room_type <> 'admin' or m.role = any (array['admin', 'sub_admin']::public.role_enum[]))
    )
  );

-- 반응을 다는 조건은 '읽을 수 있는가'와 같다. 글은 못 쓰지만 읽기는 되는 방(공지 채널 등)에서도
-- 반응은 허용한다 — 반응은 대화에 끼어드는 게 아니라 읽었다는 표시에 가깝기 때문.
-- 다만 남의 이름으로는 달 수 없다(user_id 고정).
drop policy if exists "message_reactions_insert" on public.message_reactions;
create policy "message_reactions_insert" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      exists (
        select 1
        from public.messages msg
        join public.channels c on c.id = msg.channel_id
        join public.union_members m on m.union_id = c.union_id
        where msg.id = message_reactions.message_id
          and m.user_id = (select auth.uid())
          and m.join_status = 'approved'
          and (c.type <> 'admin_only' or m.role = any (array['admin', 'sub_admin']::public.role_enum[]))
      )
      or exists (
        select 1
        from public.raid_messages rm
        join public.union_members m on m.union_id = rm.union_id
        where rm.id = message_reactions.raid_message_id
          and m.user_id = (select auth.uid())
          and m.join_status = 'approved'
          and (rm.room_type <> 'admin' or m.role = any (array['admin', 'sub_admin']::public.role_enum[]))
      )
    )
  );

-- 지우는 것은 자기 반응만. 관리자가 남의 반응을 떼어낼 이유가 없고,
-- 원본 메시지가 지워지면 on delete cascade 로 함께 사라진다.
drop policy if exists "message_reactions_delete" on public.message_reactions;
create policy "message_reactions_delete" on public.message_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- UPDATE 정책은 두지 않는다 — 반응은 추가/삭제만 있고 고쳐 쓸 일이 없다.


-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime
-- ─────────────────────────────────────────────────────────────────────────────
-- REPLICA IDENTITY 는 기본값(primary key)으로 둔다. Realtime 은 DELETE 이벤트에 RLS 를
-- 적용하지 못해 구독자 전원에게 뿌리므로, FULL 로 바꾸면 남의 길드 반응 행까지 새어 나간다.
-- 화면은 이미 가지고 있는 행을 id 로 지우기만 하면 되니 기본값으로 충분하다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
