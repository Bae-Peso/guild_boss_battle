-- 채팅 조회/RLS 인덱스 정리.
--
-- pg_stat_statements 기준(2026-10-13) 앱 쿼리 중 가장 느린 두 개가 messages 를 순차 스캔하고 있었다.
--   · 안읽음 검사  channel_id = ? AND created_at > ?          72k회, 평균 63ms
--   · 채팅 진입    channel_id = ? AND deleted_at IS NULL
--                  ORDER BY created_at DESC LIMIT 100           23k회, 평균 22ms
-- messages 에는 기본키 인덱스뿐이라, 100건을 얻으려고 테이블 전체(약 4.7만 행)를 읽고 정렬했다.

-- 두 쿼리 모두 channel_id 등호 + created_at 범위/정렬이라 이 하나로 커버된다.
-- deleted_at 은 걸러지는 행이 거의 없어 인덱스에 넣지 않는다(안읽음 검사는 deleted_at 조건이 없다).
create index if not exists messages_channel_created_idx
  on public.messages (channel_id, created_at desc);

-- 거의 모든 RLS 정책이 `union_members.user_id = auth.uid()` 로 소속을 확인한다.
-- 기존 유니크 제약은 (union_id, user_id) 순서라 user_id 단독 조회에는 쓰이지 않는다.
-- Realtime 은 변경 1건마다 구독자 수만큼 이 RLS 검사를 돌리므로 호출 빈도가 매우 높다.
create index if not exists union_members_user_idx
  on public.union_members (user_id);

-- 기본키 (user_id, scope_key) 의 선두 컬럼과 겹치는 중복 인덱스.
-- 조회에는 기본키가 그대로 쓰이고, 읽음 upsert 때마다 쓸데없이 함께 갱신되기만 했다.
drop index if exists public.chat_read_state_user_idx;
