import { REACTION_EMOJIS } from '../../lib/reactions';

// 메뉴가 화면 아래로 넘칠 만한 위치면 커서 위쪽으로 펼친다.
// (메뉴 높이는 항목 수에 따라 달라지므로 가장 긴 경우를 기준으로 잡는다)
const MENU_MAX_HEIGHT = 170;

const itemStyle = (color) => ({ padding: '8px 12px', cursor: 'pointer', color, fontSize: '0.9rem' });

// 메시지 우클릭 컨텍스트 메뉴(반응/수정/삭제). (일반/지휘 채팅 공용)
// 수정·삭제 권한이 없는 사람에게도 열린다 — 반응은 누구나 달 수 있기 때문.
export default function MessageContextMenu({ x, y, canEdit, canDelete, onEdit, onDelete, onReact, myReactions }) {
  const flipUp = typeof window !== 'undefined' && y > window.innerHeight - MENU_MAX_HEIGHT;

  return (
    <div
      style={{
        position: 'fixed',
        top: y,
        left: x,
        transform: flipUp ? 'translateY(-100%)' : undefined,
        backgroundColor: 'var(--surface-1)',
        border: '1px solid var(--border-2)',
        borderRadius: '4px',
        padding: '4px 0',
        zIndex: 1000,
        minWidth: '150px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {onReact && (
        <div style={{ display: 'flex', gap: '4px', padding: '4px 8px', borderBottom: (canEdit || canDelete) ? '1px solid var(--border-1)' : 'none' }}>
          {REACTION_EMOJIS.map(r => (
            <button
              key={r.emoji}
              type="button"
              className={`chat-react-btn${myReactions?.has(r.emoji) ? ' is-mine' : ''}`}
              title={`${r.label} 반응`}
              aria-label={`${r.label} 반응`}
              onClick={() => onReact(r.emoji)}
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
      {canEdit && (
        <div
          style={itemStyle('var(--text-strong)')}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4f545c'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          onClick={onEdit}
        >
          ✏️ 메시지 수정
        </div>
      )}
      {canDelete && (
        <div
          style={itemStyle('var(--danger-bright)')}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = '#4f545c'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
          onClick={onDelete}
        >
          🗑️ 메시지 삭제
        </div>
      )}
    </div>
  );
}
