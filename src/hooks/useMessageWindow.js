import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// 채팅 메시지 목록을 '창(window)' 단위로 들고 있는 훅 (일반 채팅 / 지휘 채팅 공용)
//
// 과거로 계속 올라가면 불러온 메시지가 전부 메모리와 DOM 에 쌓인다. 그래서 최대 MAX_SIZE 개만
// 들고 있고, 과거를 더 불러오면 가장 최신 쪽을, 다시 최신 쪽을 불러오면 가장 오래된 쪽을 잘라낸다.
//   hasMore  : 위(과거)로 더 불러올 것이 있다
//   hasNewer : 아래(최신)를 잘라냈다 — 이 동안 실시간으로 온 메시지는 붙이지 않고 missedNew 만 켠다
//
// 위아래를 동시에 넣고 빼면 '높이 차이'로 스크롤을 보정할 수 없으므로, 화면에 있던 메시지 하나를
// 기준점으로 잡아 렌더 직후(페인트 전) 그 메시지가 같은 자리에 오도록 맞춘다.
// 메시지 요소에는 data-msg-id 속성이 있어야 한다.

const PAGE_SIZE = 100;
const MAX_SIZE = 300;
const NEWER_LOAD_THRESHOLD = 300; // 맨 아래에서 이 정도(px) 이내로 내려오면 최신 쪽을 이어 불러온다
const AT_BOTTOM_THRESHOLD = 80;   // useChatAutoScroll 의 '맨 아래' 판정과 같은 값
const UNREAD_CONTEXT = 30;        // 안읽은 메시지부터 열 때, 그 위에 함께 불러올 이미 읽은 메시지 수

const byCreatedAt = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

// 컨테이너 안에서 메시지 요소의 현재 위치(컨테이너 상단 기준)를 기준점으로 잡는다.
function anchorOf(container, id) {
  if (!container || !id) return null;
  const el = container.querySelector(`[data-msg-id="${CSS.escape(String(id))}"]`);
  if (!el) return null;
  return { type: 'anchor', id, offset: el.getBoundingClientRect().top - container.getBoundingClientRect().top };
}

function isNearBottom(container, threshold) {
  return !container || container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function mergeById(base, extra) {
  if (extra.length === 0) return base;
  const seen = new Set(base.map(m => m.id));
  const added = extra.filter(m => !seen.has(m.id));
  return added.length === 0 ? base : [...base, ...added].sort(byCreatedAt);
}

/**
 * @param containerRef 스크롤 컨테이너 ref
 * @param resetKey     채널/방/시즌 식별자. 바뀌면 목록을 비운다
 * @param fetchPage    ({ before?, after?, limit }) => Promise<오름차순 메시지 배열>
 *                     before: 그보다 과거의 최신 limit 개 / after: 그보다 최신의 오래된 limit 개 / 둘 다 없으면 최신 limit 개
 */
export function useMessageWindow({ containerRef, resetKey, fetchPage }) {
  const [messages, setMessagesState] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [hasNewer, setHasNewer] = useState(false);
  const [missedNew, setMissedNew] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);

  // 모든 변경을 동기적으로 이 ref 에 먼저 반영한다 — 비동기 응답 처리 시 항상 최신 목록 기준으로 계산하기 위함.
  const messagesRef = useRef([]);
  const hasMoreRef = useRef(false);
  const hasNewerRef = useRef(false);
  const busyRef = useRef({ older: false, newer: false });
  // 최신 쪽이 잘려 있는 동안 실시간으로 온 메시지. 최신 쪽을 다시 다 채우는 순간 합친다
  // (그 조회와 실시간 도착이 엇갈리면 어느 쪽에도 안 잡혀 빠지는 메시지가 생긴다).
  const detachedLiveRef = useRef([]);
  const genRef = useRef(0);
  const fetchPageRef = useRef(fetchPage);
  // 레이아웃 효과에서 갱신해, 같은 커밋의 일반 effect(첫 로드)가 이미 새 채널 기준의 fetchPage 를 보게 한다.
  useLayoutEffect(() => { fetchPageRef.current = fetchPage; }, [fetchPage]);

  // 렌더 직후 적용할 스크롤 보정: { type: 'anchor', id, offset } | { type: 'bottom' }
  const pendingScrollRef = useRef(null);
  // 페이지 이동으로 목록이 바뀐 커밋임을 useChatAutoScroll 에 알린다(새 메시지로 오인해 자동 스크롤하지 않도록).
  const pagingRef = useRef(false);

  const commit = useCallback((next) => {
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

  const setFlags = useCallback(({ more, newer }) => {
    if (more !== undefined) { hasMoreRef.current = more; setHasMore(more); }
    if (newer !== undefined) {
      hasNewerRef.current = newer;
      setHasNewer(newer);
      if (!newer) setMissedNew(false);
    }
  }, []);

  /** 수정/삭제 등 일반적인 변경. useState 의 setter 와 같은 모양으로 쓴다. */
  const setMessages = useCallback((updater) => {
    // 수정/삭제 이벤트는 따로 받아둔 실시간 메시지에도 똑같이 적용한다(지워진 메시지가 나중에 되살아나지 않도록).
    if (typeof updater === 'function' && detachedLiveRef.current.length > 0) {
      detachedLiveRef.current = updater(detachedLiveRef.current);
    }
    const next = typeof updater === 'function' ? updater(messagesRef.current) : updater;
    if (next !== messagesRef.current) commit(next);
  }, [commit]);

  /** 체험 모드 등 이미 가진 목록으로 통째로 바꾼다. */
  const replace = useCallback((rows, { more = false } = {}) => {
    commit(rows);
    setFlags({ more, newer: false });
  }, [commit, setFlags]);

  useEffect(() => {
    genRef.current += 1;
    busyRef.current = { older: false, newer: false };
    detachedLiveRef.current = [];
    pendingScrollRef.current = null;
    commit([]);
    setFlags({ more: false, newer: false });
    setLoadingOlder(false);
    setLoadingNewer(false);
  }, [resetKey, commit, setFlags]);

  /**
   * 최신 PAGE_SIZE 개를 불러온다. 첫 진입과 '최신으로 이동' 공용.
   * 그사이 실시간으로 받은 메시지는 버리지 않고 합친다.
   * unreadAfter(마지막 읽음 시각)를 주면, 안읽은 메시지가 최신 한 페이지에 다 들어가지 않을 때
   * 최신 대신 '첫 안읽은 메시지' 주변(그 위 UNREAD_CONTEXT 개 + 그 뒤 PAGE_SIZE 개)을 연다.
   * 이때는 최신 쪽이 잘린 창(hasNewer)이 되어, 아래로 내려가며 이어 읽는다.
   */
  const loadLatest = useCallback(async ({ scrollToBottom = false, unreadAfter = null } = {}) => {
    // 진행 중이던 과거/최신 페이지 응답은 이어 붙일 자리가 없어지므로 버린다.
    const gen = ++genRef.current;
    busyRef.current = { older: false, newer: false };
    setLoadingOlder(false);
    setLoadingNewer(false);
    let rows;
    let more;
    let around = false;
    try {
      rows = await fetchPageRef.current({ limit: PAGE_SIZE });
      more = rows.length === PAGE_SIZE;
      // 최신 한 페이지가 전부 안읽은 메시지면, 첫 안읽은 메시지가 그보다 더 위에 있다.
      if (unreadAfter && more && new Date(rows[0].created_at) > new Date(unreadAfter)) {
        const [before, after] = await Promise.all([
          fetchPageRef.current({ before: unreadAfter, limit: UNREAD_CONTEXT }),
          fetchPageRef.current({ after: unreadAfter, limit: PAGE_SIZE }),
        ]);
        rows = [...before, ...after];
        more = before.length === UNREAD_CONTEXT;
        around = true;
      }
    } catch (err) {
      console.error('메시지 로드 실패:', err);
      return;
    }
    if (gen !== genRef.current) return; // 그 사이 방이 바뀌었다
    // 잘려 있던 창은 이어 붙일 수 없으니, 그동안 따로 받아둔 실시간 메시지만 합친다.
    const prev = hasNewerRef.current ? detachedLiveRef.current : messagesRef.current;
    if (around) {
      // 최신 쪽이 잘린 창이므로, 불러오는 동안 붙은 실시간 메시지는 따로 받아둔다(최신을 다 채울 때 합친다).
      const newest = new Date(rows[rows.length - 1].created_at);
      detachedLiveRef.current = prev.filter(m => new Date(m.created_at) > newest);
      commit(rows);
      setFlags({ more, newer: true });
      if (detachedLiveRef.current.length > 0) setMissedNew(true);
      return;
    }
    detachedLiveRef.current = [];
    const newestFetched = rows.length ? rows[rows.length - 1].created_at : null;
    const live = newestFetched ? prev.filter(m => m.created_at > newestFetched) : prev;
    if (scrollToBottom) {
      pendingScrollRef.current = { type: 'bottom' };
      pagingRef.current = true;
    }
    commit(mergeById(rows, live));
    setFlags({ more, newer: false });
  }, [commit, setFlags]);

  /** 위(과거)로 한 페이지. 창이 넘치면 최신 쪽을 잘라낸다. */
  const loadOlder = useCallback(async () => {
    const current = messagesRef.current;
    if (!hasMoreRef.current || busyRef.current.older || current.length === 0) return;
    busyRef.current.older = true;
    setLoadingOlder(true);
    const gen = genRef.current;
    try {
      const rows = await fetchPageRef.current({ before: current[0].created_at, limit: PAGE_SIZE });
      if (gen !== genRef.current) return;
      if (rows.length === 0) {
        setFlags({ more: false });
        return;
      }
      const base = messagesRef.current;
      let next = mergeById(base, rows);
      let trimmed = false;
      if (next.length > MAX_SIZE) {
        next = next.slice(0, MAX_SIZE);
        trimmed = true;
      }
      pendingScrollRef.current = anchorOf(containerRef.current, base[0]?.id);
      pagingRef.current = true;
      commit(next);
      setFlags({ more: rows.length === PAGE_SIZE, ...(trimmed ? { newer: true } : {}) });
    } catch (err) {
      console.error('이전 메시지 로드 실패:', err);
    } finally {
      if (gen === genRef.current) {
        busyRef.current.older = false;
        setLoadingOlder(false);
      }
    }
  }, [commit, setFlags, containerRef]);

  /** 아래(최신)로 한 페이지. 잘라냈던 최신 쪽을 다시 채우고, 창이 넘치면 오래된 쪽을 잘라낸다. */
  const loadNewer = useCallback(async () => {
    const current = messagesRef.current;
    if (!hasNewerRef.current || busyRef.current.newer || current.length === 0) return;
    busyRef.current.newer = true;
    setLoadingNewer(true);
    const gen = genRef.current;
    try {
      const rows = await fetchPageRef.current({ after: current[current.length - 1].created_at, limit: PAGE_SIZE });
      if (gen !== genRef.current) return;
      const base = messagesRef.current;
      const reachedLatest = rows.length < PAGE_SIZE;
      let next = mergeById(base, rows);
      if (reachedLatest) {
        next = mergeById(next, detachedLiveRef.current);
        detachedLiveRef.current = [];
      }
      let trimmed = false;
      if (next.length > MAX_SIZE) {
        next = next.slice(next.length - MAX_SIZE);
        trimmed = true;
      }
      pendingScrollRef.current = anchorOf(containerRef.current, base[base.length - 1]?.id);
      pagingRef.current = true;
      commit(next);
      setFlags({ newer: !reachedLatest, ...(trimmed ? { more: true } : {}) });
    } catch (err) {
      console.error('최신 메시지 로드 실패:', err);
    } finally {
      if (gen === genRef.current) {
        busyRef.current.newer = false;
        setLoadingNewer(false);
      }
    }
  }, [commit, setFlags, containerRef]);

  /**
   * 실시간 수신 / 방금 보낸 메시지를 맨 아래에 붙인다. 붙였으면 true.
   * 최신 쪽을 잘라낸 상태면 붙이지 않고 missedNew 만 켠다(이어지지 않는 메시지가 끼면 순서가 깨진다).
   * 단 내가 보낸 메시지(own)면 최신으로 이동한다 — 보낸 글이 안 보이면 전송이 안 된 것처럼 보인다.
   */
  const appendLive = useCallback((row, { own = false } = {}) => {
    if (!row?.id) return false;
    if (hasNewerRef.current) {
      const buf = detachedLiveRef.current;
      if (!buf.some(m => m.id === row.id)) detachedLiveRef.current = [...buf, row].slice(-PAGE_SIZE);
      if (own) loadLatest({ scrollToBottom: true });
      else setMissedNew(true);
      return false;
    }
    const prev = messagesRef.current;
    if (prev.some(m => m.id === row.id)) return false;
    let next = [...prev, row];
    // 재접속 후 메워 넣은 메시지는 그보다 나중 메시지가 먼저 도착해 있을 수 있다 — 시간순을 지킨다.
    if (prev.length > 0 && row.created_at < prev[prev.length - 1].created_at) next.sort(byCreatedAt);
    // 맨 아래에 있을 때만 오래된 쪽을 잘라낸다 — 곧바로 맨 아래로 다시 붙으므로 화면이 튀지 않는다.
    if (next.length > MAX_SIZE && isNearBottom(containerRef.current, AT_BOTTOM_THRESHOLD)) {
      next = next.slice(next.length - MAX_SIZE);
      setFlags({ more: true });
    }
    commit(next);
    return true;
  }, [commit, setFlags, containerRef, loadLatest]);

  /** 컨테이너 onScroll 에서 호출. 위 끝이면 과거를, 최신이 잘려 있고 아래 끝 근처면 최신을 불러온다. */
  const onScrollEdges = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.scrollTop === 0) loadOlder();
    else if (hasNewerRef.current && isNearBottom(el, NEWER_LOAD_THRESHOLD)) loadNewer();
  }, [containerRef, loadOlder, loadNewer]);

  // 페이지 이동 직후, 페인트 전에 스크롤 위치를 맞춘다.
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const container = containerRef.current;
    pendingScrollRef.current = null;
    if (!pending || !container) return;
    if (pending.type === 'bottom') {
      container.scrollTop = container.scrollHeight;
      return;
    }
    const now = anchorOf(container, pending.id);
    if (now) container.scrollTop += now.offset - pending.offset;
  }, [messages, containerRef]);

  // pagingRef 는 같은 커밋의 레이아웃 효과(useChatAutoScroll)가 다 읽은 뒤에 내린다.
  useEffect(() => {
    pagingRef.current = false;
  }, [messages]);

  return {
    messages, setMessages, replace,
    hasMore, hasNewer, missedNew, loadingOlder, loadingNewer,
    loadLatest, loadOlder, loadNewer, appendLive, onScrollEdges,
    pagingRef,
  };
}
