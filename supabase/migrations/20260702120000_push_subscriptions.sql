-- Web Push 구독 저장 테이블 (기기/브라우저별 1행, endpoint가 고유 식별자)
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subs_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);

create policy "push_subs_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

create policy "push_subs_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "push_subs_delete_own" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
