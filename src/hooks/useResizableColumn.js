import { useState, useRef, useCallback, useEffect } from 'react';
import './useResizableColumn.css';

// 엑셀처럼 열 경계를 드래그해 특정 컬럼(예: 비고)의 폭을 조절하는 훅.
// - 반환된 width(px)를 해당 컬럼의 <th>/<td>(또는 내부 래퍼)에 적용한다.
// - resizerProps 를 헤더 우측 경계의 드래그 핸들 요소에 스프레드한다.
// - 조절한 폭은 localStorage(storageKey)에 유지된다.
// 포인터 이벤트를 사용해 마우스/터치 모두 지원한다.
export function useResizableColumn(storageKey, defaultWidth, { min = 80, max = 900 } = {}) {
  const [width, setWidth] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(storageKey), 10);
      if (Number.isFinite(v) && v >= min && v <= max) return v;
    } catch { /* ignore */ }
    return defaultWidth;
  });

  const drag = useRef(null); // { startX, startW }

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(width)); } catch { /* ignore */ }
  }, [storageKey, width]);

  const onMove = useCallback((e) => {
    if (!drag.current) return;
    const delta = e.clientX - drag.current.startX;
    const next = Math.max(min, Math.min(max, drag.current.startW + delta));
    setWidth(next);
  }, [min, max]);

  const stop = useCallback(() => {
    drag.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', stop);
  }, [onMove]);

  const startResize = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { startX: e.clientX, startW: width };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
  }, [width, onMove, stop]);

  // 언마운트 시 남은 리스너 정리
  useEffect(() => () => stop(), [stop]);

  const resizerProps = {
    onPointerDown: startResize,
    // 헤더 정렬 클릭과 겹치지 않도록 클릭 전파를 막는다.
    onClick: (e) => e.stopPropagation(),
    className: 'col-resizer',
    role: 'separator',
    'aria-orientation': 'vertical',
    title: '드래그하여 열 너비 조절',
  };

  return { width, resizerProps, setWidth };
}
