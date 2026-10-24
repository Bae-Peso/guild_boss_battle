import { useState } from 'react';

/**
 * 추천 스쿼드 메모(📝) 배지.
 * 데스크톱: 호버로 툴팁 표시, 클릭으로 고정(pin)/해제. 모바일: 클릭 시 중앙 모달.
 * 모의전 대시보드/등록 모달/업로드 모달 등 추천 덱이 나오는 곳에서 공용으로 쓴다.
 * (툴팁·모달은 position:fixed이므로 모달 내부에서도 잘리지 않게 z-index를 모달보다 높게 둔다.)
 */
export default function SquadMemoBadge({ memo, isNarrow }) {
  const [tip, setTip] = useState({ visible: false, x: 0, y: 0, pinned: false });
  const [modalOpen, setModalOpen] = useState(false);

  if (!memo) return null;

  const showAt = (el, pinned) => {
    const rect = el.getBoundingClientRect();
    setTip({ visible: true, x: rect.right + 10, y: rect.top, pinned });
  };
  const hide = () => setTip({ visible: false, x: 0, y: 0, pinned: false });

  return (
    <>
      <div
        style={{ cursor: isNarrow ? 'pointer' : 'help', display: 'inline-block' }}
        onMouseEnter={isNarrow ? undefined : (e) => { if (!tip.pinned) showAt(e.currentTarget, false); }}
        onMouseLeave={isNarrow ? undefined : () => { if (!tip.pinned) hide(); }}
        onClick={(e) => {
          if (isNarrow) { setModalOpen(true); return; }
          if (tip.pinned) setTip(t => ({ ...t, pinned: false }));
          else showAt(e.currentTarget, true);
        }}
      >
        📝
      </div>

      {/* 데스크톱: 호버/고정 툴팁 */}
      {!isNarrow && tip.visible && (
        <div style={{
          position: 'fixed',
          top: tip.y,
          left: tip.x,
          width: '250px',
          backgroundColor: 'var(--surface-1)',
          color: 'var(--text-strong)',
          textAlign: 'left',
          borderRadius: '6px',
          padding: '10px',
          zIndex: 10005,
          border: '1px solid var(--accent-green)',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          boxShadow: '0px 4px 10px rgba(0,0,0,0.5)',
          fontSize: '0.9rem',
          pointerEvents: tip.pinned ? 'auto' : 'none',
          cursor: tip.pinned ? 'text' : 'default'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: tip.pinned ? '5px' : '0' }}>
            {tip.pinned && <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>📌 켜짐</span>}
            {tip.pinned && (
              <button onClick={hide} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}>✕</button>
            )}
          </div>
          {memo}
        </div>
      )}

      {/* 모바일: 중앙 모달 */}
      {isNarrow && modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10005, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setModalOpen(false)}>
          <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', width: '400px', maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--surface-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--text-strong)', fontSize: '1rem' }}>📝 덱 메모</h3>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.3rem' }}>✕</button>
            </div>
            <div style={{ padding: '16px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-strong)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              {memo}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
