import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';

// 채팅 스크롤 동작 공통 훅 (일반 채팅 / 지휘 채팅 공용)
// - 최초 로드 시 맨 아래로 이동
// - 과거 메시지 prepend 시에는 위치 유지(자동 스크롤 안 함)
// - 새 메시지 append 시: 내가 보냈거나 이미 맨 아래면 따라 내려가고,
//   위쪽(과거)을 보고 있으면 '새 메시지' 배지만 띄움
// - 맨 아래에 붙어 있는 동안에는 내용 높이가 늦게 바뀌어도(이미지/아바타 로드, 리액션, 구분선 등)
//   ResizeObserver 로 계속 맨 아래에 붙여 둔다
// containerRef 를 넘기면 그 ref 를 쓴다(useMessageWindow 와 같은 컨테이너를 공유할 때).
// pagingRef.current 가 true 인 커밋은 페이지 이동(과거/최신 불러오기)이라 새 메시지로 보지 않는다.
// initialTargetId(첫 안읽은 메시지 id)를 넘기면 최초 로드 때 맨 아래 대신 그 메시지가 화면 위쪽에 오도록 연다.
const BOTTOM_THRESHOLD = 80; // 이 정도(px) 이내면 '맨 아래'로 간주
const SMOOTH_FALLBACK_MS = 1000; // scrollend 를 지원하지 않는 브라우저용 부드러운 스크롤 종료 추정 시간
const UNREAD_TOP_RATIO = 0.25; // 첫 안읽은 메시지를 화면 위에서 이 비율만큼 내려온 자리에 둔다(위쪽 고정 날짜 구분선에 가리지 않도록)

export function useChatAutoScroll({ messages, currentUserId, loading, resetKey, containerRef: externalRef, pagingRef, initialTargetId = null }) {
  const internalRef = useRef(null);
  const containerRef = externalRef || internalRef;
  // '맨 아래에 붙어 있음' 상태. 사용자가 위로 스크롤했을 때만 풀린다.
  const isAtBottomRef = useRef(true);
  const didInitialRef = useRef(false);
  const prevLastIdRef = useRef(null);
  const prevLenRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const smoothingRef = useRef(false); // scrollToBottom('smooth') 진행 중
  const smoothTimerRef = useRef(null);

  const [atBottom, setAtBottom] = useState(true);
  const [showNewBadge, setShowNewBadge] = useState(false);
  const [initialScrolled, setInitialScrolled] = useState(false);

  const computeAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
  }, [containerRef]);

  const endSmooth = useCallback(() => {
    smoothingRef.current = false;
    clearTimeout(smoothTimerRef.current);
  }, []);

  // 즉시 맨 아래로. 부드러운 스크롤 중이면 끊지 않고 목표만 새 맨 아래로 바꾼다.
  const pin = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (smoothingRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      return;
    }
    el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [containerRef]);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    const el = containerRef.current;
    if (!el) return;
    if (behavior === 'smooth') {
      smoothingRef.current = true;
      clearTimeout(smoothTimerRef.current);
      smoothTimerRef.current = setTimeout(() => {
        endSmooth();
        if (isAtBottomRef.current) pin();
      }, SMOOTH_FALLBACK_MS);
    } else {
      endSmooth();
    }
    el.scrollTo({ top: el.scrollHeight, behavior });
    isAtBottomRef.current = true;
    setAtBottom(true);
    setShowNewBadge(false);
  }, [containerRef, endSmooth, pin]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const bottom = computeAtBottom();
    if (bottom) {
      isAtBottomRef.current = true;
    } else if (top < lastScrollTopRef.current - 1) {
      // 위로 올라갔다 = 사용자가 스크롤했다
      isAtBottomRef.current = false;
      endSmooth();
    }
    // 그 밖(아래로 갔는데 맨 아래가 아님)은 대개 내용이 늘면서 생긴 스크롤(스크롤 앵커링 등)이라 상태를 유지한다.
    // 이걸 '사용자가 벗어남'으로 보면, 이미지가 로드되며 생긴 스크롤 이벤트 하나로 맨 아래 고정이 풀려버린다.
    lastScrollTopRef.current = top;
    if (isAtBottomRef.current && !bottom && !smoothingRef.current) pin();
    setAtBottom(isAtBottomRef.current);
    if (isAtBottomRef.current) setShowNewBadge(false);
  }, [containerRef, computeAtBottom, endSmooth, pin]);

  // 이미지 등 콘텐츠 높이가 늦게 잡힐 때, 맨 아래에 있었다면 계속 맨 아래 유지
  const stickToBottom = useCallback(() => {
    if (isAtBottomRef.current) pin();
  }, [pin]);

  // 내용/컨테이너 크기가 바뀌면 맨 아래 고정을 유지한다.
  // 컨테이너 자체(입력창 높이 변화 등)와 그 직계 자식(날짜 묶음)을 관찰하고, 자식 목록이 바뀌면 다시 붙인다.
  // 컨테이너 요소가 다시 만들어질 수 있으므로(로딩 중 다른 화면을 렌더하는 경우) 매 렌더마다 요소가 바뀌었는지 확인한다.
  const observedRef = useRef(null);
  useEffect(() => {
    const el = containerRef.current;
    if (observedRef.current?.el === el) return;
    observedRef.current?.disconnect();
    observedRef.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => {
      if (isAtBottomRef.current) pin();
    });
    ro.observe(el);
    Array.from(el.children).forEach(child => ro.observe(child));
    const mo = new MutationObserver(records => {
      records.forEach(r => {
        r.addedNodes.forEach(n => { if (n.nodeType === 1) ro.observe(n); });
        r.removedNodes.forEach(n => { if (n.nodeType === 1) ro.unobserve(n); });
      });
    });
    mo.observe(el, { childList: true });
    const onScrollEnd = () => {
      if (!smoothingRef.current) return;
      endSmooth();
      if (isAtBottomRef.current) pin();
    };
    el.addEventListener('scrollend', onScrollEnd);

    observedRef.current = {
      el,
      disconnect: () => {
        ro.disconnect();
        mo.disconnect();
        el.removeEventListener('scrollend', onScrollEnd);
      }
    };
  });
  useEffect(() => () => {
    observedRef.current?.disconnect();
    observedRef.current = null;
    clearTimeout(smoothTimerRef.current);
  }, []);

  // 채널/방 전환 시 초기화
  useEffect(() => {
    didInitialRef.current = false;
    prevLastIdRef.current = null;
    prevLenRef.current = 0;
    isAtBottomRef.current = true;
    lastScrollTopRef.current = 0;
    endSmooth();
    setAtBottom(true);
    setShowNewBadge(false);
    setInitialScrolled(false);
  }, [resetKey, endSmooth]);

  // 최초 로드 시 1회 맨 아래로 (페인트 전에 처리해 깜빡임 방지)
  // 안읽은 메시지가 있으면 맨 아래 대신 첫 안읽은 메시지(새로운 메시지 구분선)가 위쪽에 오게 둔다.
  // 이후 늦게 늘어나는 높이는 위의 ResizeObserver 가 따라간다(맨 아래에 있을 때만).
  useLayoutEffect(() => {
    if (loading || didInitialRef.current) return;
    const el = containerRef.current;
    const target = el && initialTargetId != null
      ? el.querySelector(`[data-msg-id="${CSS.escape(String(initialTargetId))}"]`)
      : null;
    if (target) {
      const offset = target.getBoundingClientRect().top - el.getBoundingClientRect().top;
      el.scrollTop += offset - el.clientHeight * UNREAD_TOP_RATIO;
      // 안읽은 메시지가 몇 개 안 되면 스크롤이 끝까지 내려가 결국 맨 아래가 된다 — 그때는 평소처럼 고정한다.
      isAtBottomRef.current = computeAtBottom();
      lastScrollTopRef.current = el.scrollTop;
      setAtBottom(isAtBottomRef.current);
    } else {
      isAtBottomRef.current = true;
      if (messages.length > 0) pin();
    }
    didInitialRef.current = true;
    prevLastIdRef.current = messages.length ? messages[messages.length - 1].id : null;
    prevLenRef.current = messages.length;
    setInitialScrolled(true);
  }, [loading, messages, pin, initialTargetId, containerRef, computeAtBottom]);

  // 새로 추가된(맨 아래) 메시지 처리
  useLayoutEffect(() => {
    if (!didInitialRef.current) return;
    const len = messages.length;
    const lastId = len ? messages[len - 1].id : null;

    if (pagingRef?.current) {
      // useMessageWindow 가 (먼저 실행된 레이아웃 효과에서) 맞춘 위치 기준으로 고정 여부를 다시 정한다.
      // 맨 아래에서 최신 쪽을 이어 불러온 경우 고정을 풀어야, 늘어난 내용 끝으로 끌려가며 연달아 불러오지 않는다.
      const el = containerRef.current;
      if (el) {
        endSmooth();
        isAtBottomRef.current = computeAtBottom();
        lastScrollTopRef.current = el.scrollTop;
        setAtBottom(isAtBottomRef.current);
      }
      prevLastIdRef.current = lastId;
      prevLenRef.current = len;
      return;
    }

    // 마지막 메시지 id가 바뀌고 길이가 줄지 않았으면 = 맨 아래에 새 메시지가 붙은 것
    // (과거 prepend는 마지막 id가 그대로, 삭제는 길이가 줄어듦)
    if (lastId !== prevLastIdRef.current && len >= prevLenRef.current) {
      const lastMsg = messages[len - 1];
      const mine = lastMsg && lastMsg.user_id === currentUserId;
      if (mine || isAtBottomRef.current) {
        scrollToBottom('smooth');
      } else {
        setShowNewBadge(true);
      }
    }
    prevLastIdRef.current = lastId;
    prevLenRef.current = len;
  }, [messages, currentUserId, scrollToBottom, pagingRef, containerRef, computeAtBottom, endSmooth]);

  return { containerRef, onScroll, scrollToBottom, stickToBottom, atBottom, showNewBadge, initialScrolled };
}
