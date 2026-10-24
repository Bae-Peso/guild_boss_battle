import { supabase } from './supabase';

/**
 * 채팅 읽음 위치를 DB(chat_read_state)에 사용자별로 저장/조회한다.
 * 기존 localStorage(read_ch_* / read_boss_battle_*)를 대체해 브라우저 간에 읽음 위치를 공유한다.
 * 모든 쓰기는 best-effort — 실패해도 조용히 넘어간다(안읽음 계산만 스킵될 뿐 앱은 정상 동작).
 */

export const channelScope = (channelId) => `ch:${channelId}`;
export const bossBattleScope = (room, guildId) => `bossBattle:${room}:${guildId}`;

// 체험 모드에서는 읽음 상태를 DB에 읽거나 쓰지 않는다(완전 격리, 비영구).
const isDemoSession = () => {
  try { return sessionStorage.getItem('nikke_demo') === '1'; } catch { return false; }
};

// ── markRead 쓰기 묶기 ──────────────────────────────────────────────────────
// 채팅을 보고 있으면 메시지가 올 때마다 읽음 처리가 불린다. 그대로 쓰면 대화가 활발할 때
// 사람 수 × 메시지 수만큼 upsert 가 나간다(실측: 메시지 1건당 10회 이상, 전체 API 요청의 47%).
// 스코프별로 첫 호출은 바로 쓰고, 이후 MARK_READ_INTERVAL_MS 안의 호출은 마지막 값 하나로 모아
// 구간이 끝날 때 한 번만 쓴다. 아직 안 쓴 값은 아래 조회 함수들이 DB 값보다 우선해서 돌려준다.
const MARK_READ_INTERVAL_MS = 10_000;

// scopeKey → { userId, at(아직 안 쓴 값), lastWriteAt(ms), timer }
const pending = new Map();
// scopeKey → 이 탭에서 마지막으로 읽음 처리한 시각(ISO). 쓰기가 늦게 나가도 조회는 최신값을 본다.
const localReadAt = new Map();

// ISO 문자열은 사전순 비교가 곧 시간순 비교다.
const later = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

function flush(scopeKey) {
  const entry = pending.get(scopeKey);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = null;
  if (!entry.at) return;
  const { userId, at } = entry;
  entry.at = null;
  entry.lastWriteAt = Date.now();
  supabase.from('chat_read_state')
    .upsert({ user_id: userId, scope_key: scopeKey, last_read_at: at, updated_at: at },
            { onConflict: 'user_id,scope_key' })
    .then(() => {}, () => {});
}

// 탭을 닫거나 백그라운드로 보낼 때 모아둔 값을 내보낸다(다른 기기에서 바로 이어 읽을 수 있도록).
if (typeof document !== 'undefined') {
  const flushAll = () => { for (const key of pending.keys()) flush(key); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  window.addEventListener('pagehide', flushAll);
}

// 사용자의 전체 읽음 상태를 { scope_key: last_read_at(ISO) } 맵으로 반환
export async function fetchReadState(userId) {
  if (isDemoSession() || !userId) return {};
  const { data } = await supabase
    .from('chat_read_state')
    .select('scope_key, last_read_at')
    .eq('user_id', userId);
  const map = {};
  (data || []).forEach(r => { map[r.scope_key] = r.last_read_at; });
  localReadAt.forEach((at, key) => { map[key] = later(map[key], at); });
  return map;
}

// 단일 스코프의 last_read_at 하나만 조회 (채널 진입 시 bookmark 계산용). 없으면 null.
export async function fetchReadAt(userId, scopeKey) {
  if (isDemoSession() || !userId || !scopeKey) return null;
  const { data } = await supabase
    .from('chat_read_state')
    .select('last_read_at')
    .eq('user_id', userId)
    .eq('scope_key', scopeKey)
    .maybeSingle();
  return later(data?.last_read_at || null, localReadAt.get(scopeKey) || null);
}

// 단일 스코프의 읽음 시각을 now(기본)로 upsert. 짧은 간격의 연속 호출은 하나로 묶인다.
export function markRead(userId, scopeKey, at = new Date().toISOString()) {
  if (isDemoSession() || !userId || !scopeKey) return;
  const prev = localReadAt.get(scopeKey);
  if (prev && prev >= at) return; // 이미 같거나 더 늦은 시각으로 처리됨
  localReadAt.set(scopeKey, at);

  let entry = pending.get(scopeKey);
  if (!entry) {
    entry = { userId, at: null, lastWriteAt: 0, timer: null };
    pending.set(scopeKey, entry);
  }
  entry.userId = userId;
  entry.at = at;

  if (entry.timer) return; // 이미 예약된 쓰기가 최신 값을 가져간다
  const wait = entry.lastWriteAt + MARK_READ_INTERVAL_MS - Date.now();
  if (wait <= 0) flush(scopeKey);
  else entry.timer = setTimeout(() => flush(scopeKey), wait);
}

// 없던 스코프들의 baseline을 now로 한 번에 심기(첫 접속 시 과거 메시지가 전부 안읽음으로 뜨는 것 방지)
export async function seedReadState(userId, scopeKeys, at = new Date().toISOString()) {
  if (isDemoSession() || !userId || !scopeKeys?.length) return;
  await supabase.from('chat_read_state')
    .upsert(scopeKeys.map(k => ({ user_id: userId, scope_key: k, last_read_at: at, updated_at: at })),
            { onConflict: 'user_id,scope_key', ignoreDuplicates: true });
}
