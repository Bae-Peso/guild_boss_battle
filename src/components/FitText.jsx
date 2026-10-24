import { useRef, useLayoutEffect, useState } from 'react';

// 자식 텍스트를 부모 폭(widthRatio 비율) 안에서 한 줄로 표시되도록 글자 크기를 자동 축소한다.
// 부모는 폭이 고정돼야 하므로(min-width: 0 / overflow: hidden 권장) 사용처에서 보장한다.
export default function FitText({ text, maxPx = 16, minPx = 9, widthRatio = 1, weight, color, title, style }) {
  const ref = useRef(null);
  const [fontSize, setFontSize] = useState(maxPx);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const fit = () => {
      const avail = parent.clientWidth * widthRatio;
      if (avail <= 0) return;
      // 최대 크기로 놓고 자연 폭을 측정한 뒤 비율로 축소
      el.style.fontSize = `${maxPx}px`;
      const natural = el.scrollWidth;
      if (natural <= 0) return;
      const next = natural <= avail
        ? maxPx
        : Math.max(minPx, Math.min(maxPx, Math.floor(maxPx * (avail / natural))));
      el.style.fontSize = `${next}px`;
      setFontSize(next);
    };

    fit();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(fit);
      ro.observe(parent);
    }
    return () => ro?.disconnect();
  }, [text, maxPx, minPx, widthRatio]);

  return (
    <span
      ref={ref}
      title={title}
      style={{ display: 'inline-block', whiteSpace: 'nowrap', fontSize, fontWeight: weight, color, ...style }}
    >
      {text}
    </span>
  );
}
