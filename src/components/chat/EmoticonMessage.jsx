// 이모티콘($$EMOTI$$) 메시지 렌더링 (일반/지휘 채팅 공용).
// emojis: [{ url, name }] — 단일은 크게, 콤보콘(2개 이상)은 한 줄로 나란히 표시.
// compact 모드(지휘 사이드 채팅)에서는 크기를 줄인다.
export default function EmoticonMessage({ emojis, compact = false, onImageLoad }) {
  if (!emojis || emojis.length === 0) return null;
  const single = emojis.length === 1;
  const size = single ? (compact ? 84 : 110) : (compact ? 52 : 72);

  const handleError = (e) => {
    e.target.onerror = null;
    e.target.style.display = 'none';
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'flex-end' }}>
      {emojis.map((em, i) => (
        <img
          key={i}
          src={em.url}
          alt={em.name || '이모티콘'}
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={onImageLoad}
          onError={handleError}
          style={{ width: `${size}px`, height: `${size}px`, objectFit: 'contain' }}
        />
      ))}
    </div>
  );
}
