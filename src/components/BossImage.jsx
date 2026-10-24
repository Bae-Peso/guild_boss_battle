import { useState, useEffect } from 'react';
import { useGameData } from '../contexts/GameDataContext';

// 보스 이미지 표시.
// 폴백 순서: ① 보스 이미지(url) → ② 관리자가 지정한 약점 속성 이미지 → ③ 대체 텍스트(image_alt) → ④ 속성 이모지
const ELEMENT_EMOJI = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };

// fallbackFit / fallbackSize: 폴백(②~④)에만 적용되는 값. 기본은 fit / size와 같다.
// 보스 이미지를 배너처럼 크게 cover로 깔 때, 폴백인 속성 아이콘까지 같이 늘리면 뭉개지고
// 이모지는 우스꽝스럽게 커진다 — 그런 자리에서 폴백만 따로 줄이라고 열어둔 옵션이다.
//
// fade: 상·하단을 서서히 투명하게 만드는 비율(0~0.5). cover로 상하를 잘라 쓸 때 잘린 경계가
// 칼로 벤 듯 보이는 걸 막아, 이미지가 카드 배경에 녹아들게 한다. 폴백(②~④)은 잘라낸 게
// 아니라 아이콘/글자를 통째로 보여주는 것이라 마스크를 씌우지 않는다.
export default function BossImage({ url, alt, element, size = 48, fit = 'contain', fallbackFit, fallbackSize, fade = 0, style }) {
  const [failed, setFailed] = useState(false);
  const [elemFailed, setElemFailed] = useState(false);
  const { gameIcons } = useGameData();
  const elementUrl = gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;

  // URL이 바뀌면 실패 상태 초기화
  useEffect(() => { setFailed(false); }, [url]);
  useEffect(() => { setElemFailed(false); }, [elementUrl]);

  const imgStyle = { width: size, height: size, objectFit: fit, borderRadius: 6, ...style };
  const fbFit = fallbackFit || fit;
  const fbSize = fallbackSize ?? size;

  // ① 보스 이미지
  if (url && !failed) {
    const fadeStyle = fade > 0
      ? (() => {
        const mask = `linear-gradient(to bottom, transparent 0%, #000 ${fade * 100}%, #000 ${(1 - fade) * 100}%, transparent 100%)`;
        return { WebkitMaskImage: mask, maskImage: mask };
      })()
      : null;
    return <img src={url} alt={alt || element || 'boss'} onError={() => setFailed(true)} style={{ ...imgStyle, ...fadeStyle }} />;
  }
  // ② 약점 속성 이미지 (관리자 지정)
  if (elementUrl && !elemFailed) {
    return <img src={elementUrl} alt={element || 'element'} onError={() => setElemFailed(true)} style={{ ...imgStyle, objectFit: fbFit }} />;
  }
  // ③ 대체 텍스트 → ④ 속성 이모지
  return (
    <div
      title={alt || element || ''}
      style={{
        width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--surface-1)', borderRadius: 6, color: 'var(--text-soft)',
        fontSize: alt ? Math.max(10, Math.round(fbSize / 5)) : Math.round(fbSize * 0.62),
        textAlign: 'center', padding: 2, boxSizing: 'border-box', overflow: 'hidden', lineHeight: 1.1,
        ...style,
      }}
    >
      {alt ? alt : (element ? (ELEMENT_EMOJI[element] || element) : '❔')}
    </div>
  );
}
