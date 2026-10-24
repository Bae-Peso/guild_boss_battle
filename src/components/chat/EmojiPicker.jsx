import { useEffect, useRef, useState, useMemo } from 'react';
import { useGameData } from '../../contexts/GameDataContext';
import {
  MAX_COMBO_EMOTICONS,
  getRecentEmoticons,
  pushRecentEmoticons
} from '../../lib/chatUtils';

// 채팅 이모티콘 선택창 (일반/지휘 채팅 공용).
// - 상단: 카테고리 탭(최근 사용 + 패키지들), 가로 스크롤
// - 본문: 4열 그리드, 5행(20개) 이상이면 세로 스크롤
// - 단일 선택 시 즉시 전송, 콤보콘 모드에서는 최대 5개를 모아 한 번에 전송
//
// props:
//   onSend(list)  list = [{ url, name }] — 실제 전송은 부모(채팅)가 담당
//   onClose()
//   anchorRef     여는 버튼 ref (바깥 클릭 닫기에서 토글 버튼은 제외하기 위함)
//   style         절대 위치 등 부모가 지정하는 위치 스타일
export default function EmojiPicker({ onSend, onClose, anchorRef, style }) {
  const { emoticonPacks } = useGameData();
  const rootRef = useRef(null);

  const [recent, setRecent] = useState(() => getRecentEmoticons());
  const [comboMode, setComboMode] = useState(false);
  const [combo, setCombo] = useState([]); // [{ url, name }]

  // 카테고리 목록: '최근 사용' + 등록된 패키지들
  const categories = useMemo(() => {
    const packCats = (emoticonPacks || []).map(p => ({
      key: p.id,
      name: p.name,
      items: (p.emoticons || []).map(e => ({ url: e.image_url, name: e.name }))
    }));
    return [{ key: 'recent', name: '최근 사용', items: recent }, ...packCats];
  }, [emoticonPacks, recent]);

  // 기본 활성 탭: 최근 사용이 있으면 최근, 없으면 첫 패키지
  const [activeKey, setActiveKey] = useState(() => (getRecentEmoticons().length > 0 ? 'recent' : null));
  useEffect(() => {
    if (activeKey && categories.some(c => c.key === activeKey)) return;
    const firstWithItems = categories.find(c => c.items.length > 0) || categories[0];
    setActiveKey(firstWithItems ? firstWithItems.key : null);
  }, [categories, activeKey]);

  const activeCat = categories.find(c => c.key === activeKey) || categories[0];

  // 바깥 클릭 시 닫기 (여는 버튼 클릭은 토글로 동작하도록 제외)
  useEffect(() => {
    const handler = (e) => {
      if (rootRef.current && rootRef.current.contains(e.target)) return;
      if (anchorRef?.current && anchorRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  const send = (list) => {
    if (!list || list.length === 0) return;
    setRecent(pushRecentEmoticons(list));
    onSend(list);
  };

  const handlePick = (item) => {
    if (comboMode) {
      setCombo(prev => (prev.length >= MAX_COMBO_EMOTICONS ? prev : [...prev, item]));
    } else {
      send([item]);
    }
  };

  const renderImgFallback = (e) => {
    e.target.onerror = null;
    e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="%23333"/><text x="24" y="28" font-family="sans-serif" font-size="10" fill="%23888" text-anchor="middle">X</text></svg>';
  };

  return (
    <div
      ref={rootRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        width: '300px',
        maxWidth: 'calc(100vw - 20px)',
        backgroundColor: 'var(--surface-2)',
        border: '1px solid var(--border-1)',
        borderRadius: '10px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...style
      }}
    >
      {/* 헤더: 콤보콘 토글 + 닫기 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid var(--border-1)' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-strong)' }}>이모티콘</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => { setComboMode(m => !m); setCombo([]); }}
            title="2개 이상을 한 번에 전송"
            style={{
              fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer',
              padding: '4px 8px', borderRadius: '6px',
              border: comboMode ? '1px solid var(--accent-green)' : '1px solid var(--border-3)',
              backgroundColor: comboMode ? 'var(--accent-green)' : 'transparent',
              color: comboMode ? 'var(--text-inverse)' : 'var(--text-muted)'
            }}
          >
            콤보콘
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* 카테고리 탭 (가로 스크롤) */}
      <div style={{ display: 'flex', gap: '4px', padding: '6px 8px', overflowX: 'auto', borderBottom: '1px solid var(--border-1)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        {categories.map(cat => (
          <button
            key={cat.key}
            type="button"
            onClick={() => setActiveKey(cat.key)}
            style={{
              flexShrink: 0, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold',
              padding: '5px 10px', borderRadius: '6px', border: 'none',
              backgroundColor: activeKey === cat.key ? 'var(--surface-4)' : 'transparent',
              color: activeKey === cat.key ? 'var(--text-strong)' : 'var(--text-dim)'
            }}
          >
            {cat.key === 'recent' ? '🕘 ' : ''}{cat.name}
          </button>
        ))}
      </div>

      {/* 그리드 (4열, 5행 이상이면 세로 스크롤) */}
      <div style={{ padding: '8px', maxHeight: '320px', overflowY: 'auto' }}>
        {!activeCat || activeCat.items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', padding: '30px 10px' }}>
            {activeKey === 'recent' ? '최근 사용한 이모티콘이 없습니다.' : '등록된 이모티콘이 없습니다.'}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {activeCat.items.map((item, i) => (
              <button
                key={`${item.url}_${i}`}
                type="button"
                onClick={() => handlePick(item)}
                title={item.name}
                style={{ aspectRatio: '1 / 1', padding: '4px', borderRadius: '8px', border: '1px solid transparent', backgroundColor: 'var(--surface-1)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-green)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
              >
                <img
                  src={item.url}
                  alt={item.name || '이모티콘'}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  onError={renderImgFallback}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 콤보콘 트레이 */}
      {comboMode && (
        <div style={{ borderTop: '1px solid var(--border-1)', padding: '8px 10px', backgroundColor: 'var(--surface-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>선택 {combo.length} / {MAX_COMBO_EMOTICONS}</span>
            {combo.length > 0 && (
              <button type="button" onClick={() => setCombo([])} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: '0.72rem', cursor: 'pointer' }}>
                전체 비우기
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ flex: 1, display: 'flex', gap: '4px', minHeight: '34px', alignItems: 'center', flexWrap: 'wrap' }}>
              {combo.length === 0
                ? <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>이모티콘을 눌러 담아주세요.</span>
                : combo.map((item, i) => (
                    <img
                      key={i}
                      src={item.url}
                      alt={item.name || '이모티콘'}
                      referrerPolicy="no-referrer"
                      title="클릭하여 제거"
                      onClick={() => setCombo(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ width: '32px', height: '32px', objectFit: 'contain', cursor: 'pointer', backgroundColor: 'var(--surface-2)', borderRadius: '4px' }}
                    />
                  ))
              }
            </div>
            <button
              type="button"
              disabled={combo.length === 0}
              onClick={() => send(combo)}
              style={{
                flexShrink: 0, padding: '8px 14px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.8rem',
                cursor: combo.length === 0 ? 'not-allowed' : 'pointer',
                backgroundColor: combo.length === 0 ? 'var(--border-1)' : 'var(--accent-green)',
                color: combo.length === 0 ? 'var(--text-dim)' : 'var(--text-inverse)'
              }}
            >
              전송
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
