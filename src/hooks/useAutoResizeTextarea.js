import { useLayoutEffect, useRef } from 'react';

// 채팅 입력창(textarea)을 내용 줄 수에 맞춰 자동으로 늘였다 줄이는 훅.
// Shift+Enter 줄바꿈을 쓰면 입력창이 커지고 그만큼 메시지 목록이 줄어들므로,
// 맨 아래를 보고 있었다면 onResize(스크롤 고정)로 다시 맨 아래에 붙여준다.
// maxHeight 를 넘으면 더 커지지 않고 입력창 안에서 스크롤한다.
// minHeight 를 주면 내용이 짧아도 그보다 작아지지 않는다. (메시지 수정 모달처럼 처음부터 넓게 보여야 할 때)
export function useAutoResizeTextarea(value, { minHeight = 0, maxHeight = 160, onResize } = {}) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const before = el.offsetHeight;

    // 내용이 비어 있어도 placeholder 가 여러 줄로 감기면 scrollHeight 에 그대로 잡힌다.
    // (좁은 입력창에서 빈 입력창이 2줄 높이로 시작하는 문제) → 측정 동안만 placeholder 를 비운다.
    const placeholder = el.placeholder;
    el.placeholder = '';

    el.style.height = 'auto';
    // box-sizing: border-box 이므로 scrollHeight(= 패딩+내용)에 테두리 높이를 더해야 한다.
    const borderY = el.offsetHeight - el.clientHeight;
    const contentH = el.scrollHeight + borderY;
    const next = Math.max(minHeight, Math.min(contentH, maxHeight));

    el.style.height = `${next}px`;
    el.style.overflowY = contentH > maxHeight ? 'auto' : 'hidden';
    el.placeholder = placeholder;

    if (onResize && Math.round(before) !== Math.round(el.offsetHeight)) onResize();
  }, [value, minHeight, maxHeight, onResize]);

  return ref;
}
