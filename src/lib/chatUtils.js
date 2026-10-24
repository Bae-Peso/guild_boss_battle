// 채팅(일반/지휘) 공용 로직.
// - 도배 방지 쿨다운 시간(전 채팅 공통)
// - 멘션 인코딩(@닉네임 → <@user_id>) 및 멘션 대상 추출
// 표시(렌더)와 알림 발송이 동일한 경계 규칙을 쓰도록 한 곳에서 관리한다.

import { isManager } from './roles';

export const CHAT_COOLDOWN_MS = 1000;

// ── 연속 메시지 묶기(그룹핑) ────────────────────────────────────────────────
// 같은 사람이 이 시간 안에 연달아 보낸 메시지는 프로필/닉네임/시간 헤더 없이
// 바로 아래에 이어 붙여 표시한다. (짧은 메시지 여러 개가 화면을 낭비하는 문제 완화)
export const CHAT_GROUP_WINDOW_MS = 5 * 60 * 1000;

// msg 가 prevMsg 의 '이어지는 메시지'인지 판정한다.
// 날짜 구분선·'새로운 메시지' 구분선이 끼는 경우는 호출부에서 따로 제외한다.
export function isContinuation(prevMsg, msg) {
  if (!prevMsg || !msg) return false;
  if (prevMsg.user_id !== msg.user_id) return false;
  const gap = new Date(msg.created_at) - new Date(prevMsg.created_at);
  return gap >= 0 && gap < CHAT_GROUP_WINDOW_MS;
}

/**
 * '새로운 메시지' 구분선을 붙일 메시지의 index. 없으면 -1.
 * since(마지막 읽음 시각, Date) 이후의 첫 메시지이고, 그게 내가 보낸 것이 아닐 때만 해당한다.
 */
export function findFirstUnreadIndex(messages, since, userId) {
  if (!since) return -1;
  const t = since.getTime();
  const i = messages.findIndex(m => new Date(m.created_at).getTime() > t);
  return i >= 0 && messages[i].user_id !== userId ? i : -1;
}

// ── 날짜별 묶기 (스티키 날짜 헤더) ──────────────────────────────────────────
// 메시지를 날짜 단위로 묶어 [{ key, items: [{ msg, index }] }] 로 반환한다.
// 각 묶음을 하나의 컨테이너로 렌더하면 그 안의 날짜 구분선을 position: sticky 로
// 목록 최상단에 고정할 수 있다 — 다음 날짜 묶음이 올라오면 자연스럽게 밀려난다.
// index 는 원본 messages 배열에서의 위치(연속 메시지/안읽음 판정에 필요)를 그대로 유지한다.
export function groupMessagesByDay(messages) {
  const groups = [];
  (messages || []).forEach((msg, index) => {
    const d = new Date(msg.created_at);
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push({ msg, index });
    else groups.push({ key, items: [{ msg, index }] });
  });
  return groups;
}

// 닉네임이 다른 닉네임의 부분 문자열이어도 오탐하지 않도록 경계(lookahead)를 둔다.
// 긴 닉네임부터 치환하여 부분 매칭을 방지한다.
function mentionRegex(name, flags) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`@${escaped}(?=[\\s,.!?]|$)`, flags);
}

function membersByNameLengthDesc(members) {
  return [...members].sort((a, b) => (b.in_game_name?.length || 0) - (a.in_game_name?.length || 0));
}

// 전송 직전 본문의 @닉네임을 저장용 토큰 <@user_id>로 인코딩한다.
export function encodeMentions(text, members) {
  let parsed = text;
  membersByNameLengthDesc(members).forEach(m => {
    if (!m.in_game_name) return;
    parsed = parsed.replace(mentionRegex(m.in_game_name, 'g'), `<@${m.user_id}>`);
  });
  return parsed;
}

// 본문(인코딩 전 원문)에서 알림을 받을 user_id 집합과 멘션 종류를 구한다.
// 본인(selfId)은 제외한다.
export function getMentionTargets(text, members, selfId) {
  const ids = new Set();

  if (text.includes('@!all')) {
    members.forEach(m => { if (m.user_id !== selfId) ids.add(m.user_id); });
    return { ids, title: '전체 멘션' };
  }

  if (text.includes('@!mod')) {
    members.forEach(m => {
      if (m.user_id !== selfId && isManager(m.role)) ids.add(m.user_id);
    });
    return { ids, title: '관리자 멘션' };
  }

  membersByNameLengthDesc(members).forEach(m => {
    if (m.user_id === selfId || !m.in_game_name) return;
    if (mentionRegex(m.in_game_name).test(text)) ids.add(m.user_id);
  });
  return { ids, title: '개인 멘션' };
}

// 특정 본문(content)에서 '나'(userId / inGameName, 관리자 여부 isMod)가 멘션됐는지 여부.
// 안읽음/멘션 빨간점 판정에 사용. 표시·알림과 동일한 경계 규칙을 쓴다.
export function isMentioned(content, { userId, inGameName, isMod }) {
  if (!content) return false;
  if (userId && content.includes(`<@${userId}>`)) return true;
  if (content.includes('@!all')) return true;
  if (isMod && content.includes('@!mod')) return true;
  if (inGameName && mentionRegex(inGameName).test(content)) return true;
  return false;
}

// ── 이모티콘(콤보콘 포함) 메시지 ─────────────────────────────────────────────
// 스쿼드 공유($$SQUAD$$)와 동일하게 prefix + JSON 으로 본문에 인코딩한다.
// payload: { emojis: [{ url, name }] } — 단일은 1개, 콤보콘은 최대 5개.
// URL을 그대로 저장하므로 관리자가 이모티콘을 삭제/수정해도 과거 메시지는 그대로 보인다.
export const EMOTICON_PREFIX = '$$EMOTI$$';
export const MAX_COMBO_EMOTICONS = 5;

export function encodeEmoticons(list) {
  const emojis = (list || [])
    .filter(e => e && e.url)
    .slice(0, MAX_COMBO_EMOTICONS)
    .map(e => ({ url: e.url, name: e.name || '' }));
  return EMOTICON_PREFIX + JSON.stringify({ emojis });
}

// $$EMOTI$$ 메시지면 이모티콘 배열을, 아니면 null 을 반환한다.
export function parseEmoticons(content) {
  if (!content || !content.startsWith(EMOTICON_PREFIX)) return null;
  try {
    const obj = JSON.parse(content.slice(EMOTICON_PREFIX.length));
    const emojis = obj?.emojis?.filter(e => e && e.url) || [];
    return emojis.length > 0 ? emojis : null;
  } catch {
    return null;
  }
}

// ── 최근 사용 이모티콘 (브라우저 로컬에 저장, 사용자별 기기 단위) ──────────────
const RECENT_EMOTICON_KEY = 'emoticon_recent';
const RECENT_EMOTICON_MAX = 20;

export function getRecentEmoticons() {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_EMOTICON_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(e => e && e.url) : [];
  } catch {
    return [];
  }
}

// 방금 사용한 이모티콘들을 최근 목록 맨 앞에 넣고(중복 URL 제거) 갱신된 목록을 반환한다.
export function pushRecentEmoticons(used) {
  try {
    const merged = [...(used || []), ...getRecentEmoticons()];
    const seen = new Set();
    const deduped = [];
    for (const e of merged) {
      if (!e || !e.url || seen.has(e.url)) continue;
      seen.add(e.url);
      deduped.push({ url: e.url, name: e.name || '' });
      if (deduped.length >= RECENT_EMOTICON_MAX) break;
    }
    localStorage.setItem(RECENT_EMOTICON_KEY, JSON.stringify(deduped));
    return deduped;
  } catch {
    return getRecentEmoticons();
  }
}
