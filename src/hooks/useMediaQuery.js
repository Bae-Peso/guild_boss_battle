import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * CSS 미디어쿼리 매칭 여부를 리액티브하게 반환.
 * @param {string} query 예: '(max-width: 820px)'
 * @returns {boolean}
 */
export function useMediaQuery(query) {
  const getMatch = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;

  const [matches, setMatches] = useState(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    // 쿼리 변경/최초 마운트 시 현재 값으로 동기화
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/**
 * 좁은 화면(모바일/태블릿 세로) 여부. 하단 탭 셸 전환 기준.
 * @param {number} maxWidth 기본 820px 이하를 모바일로 간주
 */
export function useIsMobile(maxWidth = 820) {
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}

/**
 * 콘텐츠가 좁아 세로 스택/단일 포커스가 필요한 폭 여부. (창 폭 기준 — 주로 모달 등 전체 오버레이용)
 * 모바일 셸 전환(useIsMobile)보다 넓은 기준.
 * @param {number} maxWidth 기본 1200px 이하를 '좁음'으로 간주
 */
export function useIsNarrow(maxWidth = 1200) {
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}

/**
 * 요소의 실제 폭을 ResizeObserver로 추적. 창 폭이 아니라 '가운데 콘텐츠 영역'처럼
 * 패널 접기/펴기로 달라지는 실제 가용 폭에 반응해야 할 때 사용한다.
 * 콜백 ref라 요소가 마운트/언마운트될 때 관찰자를 자동 재연결한다.
 * @returns {[Function, number|null]} [callback ref, 현재 폭(px) 또는 null]
 */
export function useElementWidth() {
  const [width, setWidth] = useState(null);
  const observerRef = useRef(null);

  const ref = useCallback((el) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const w = entries[0]?.contentRect?.width;
        if (typeof w === 'number') setWidth(w);
      });
      ro.observe(el);
      observerRef.current = ro;
      setWidth(el.getBoundingClientRect().width);
    }
  }, []);

  return [ref, width];
}
