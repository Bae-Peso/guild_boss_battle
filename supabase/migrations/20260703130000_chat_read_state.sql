-- 채팅 읽음 위치(브라우저/기기 간 공유). 사용자 x 스코프 1행.
-- scope_key: 'ch:<channelId>' (텍스트 채널) 또는 'bossBattle:<room>:<guildId>' (지휘 general/admin)
create table if not exists public.chat_read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_key text not null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_key)
);

create index if not exists chat_read_state_user_idx
  on public.chat_read_state (user_id);

alter table public.chat_read_state enable row level security;

create policy "chat_read_state_select_own" on public.chat_read_state
  for select using (auth.uid() = user_id);

create policy "chat_read_state_insert_own" on public.chat_read_state
  for insert with check (auth.uid() = user_id);

create policy "chat_read_state_update_own" on public.chat_read_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_read_state_delete_own" on public.chat_read_state
  for delete using (auth.uid() = user_id);
