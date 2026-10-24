// 채팅 입력창 바로 위에 떠서, '새 메시지' 배지와 '최신으로 이동(↓)' 버튼을 보여주는 공용 컴포넌트.
// 부모(입력 영역 컨테이너)는 position: relative 여야 한다.
// - showNewBadge: 위쪽을 보던 중 새 메시지가 왔을 때 가운데에 표시되는 박스
// - !atBottom: 과거 메시지를 보고 있을 때 우측에 표시되는 ↓ 버튼
// 둘 중 무엇을 눌러도 onScrollToBottom 으로 동일하게 동작한다.
export default function ChatScrollControls({ atBottom, showNewBadge, onScrollToBottom }) {
  if (atBottom && !showNewBadge) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '100%',
        marginBottom: '8px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-end',
        pointerEvents: 'none',
        padding: '0 12px'
      }}
    >
      {showNewBadge && (
        <button
          type="button"
          onClick={onScrollToBottom}
          style={{
            pointerEvents: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: 'var(--accent-blurple)',
            color: 'var(--text-strong)',
            border: 'none',
            borderRadius: '999px',
            padding: '6px 14px',
            fontSize: '0.8rem',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
          }}
        >
          ↓ 새 메시지
        </button>
      )}

      {!atBottom && (
        <button
          type="button"
          onClick={onScrollToBottom}
          title="최신 메시지로 이동"
          aria-label="최신 메시지로 이동"
          style={{
            pointerEvents: 'auto',
            position: 'absolute',
            right: '12px',
            bottom: 0,
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: 'var(--surface-4)',
            color: 'var(--text-strong)',
            border: '1px solid var(--border-2)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.15rem',
            lineHeight: 1,
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)'
          }}
        >
          ↓
        </button>
      )}
    </div>
  );
}
