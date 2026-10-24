import { useEffect } from 'react';
import { useAutoResizeTextarea } from '../../hooks/useAutoResizeTextarea';
import { useEscapeKey } from '../../hooks/useEscapeKey';

// 메시지 수정 창 (일반/지휘 채팅 공용).
// 말풍선 안에서 고치던 방식은 원문 폭이 좁으면 몇 글자만 보여서, 넉넉한 모달로 분리했다.
// Enter 저장 / Shift+Enter 줄바꿈 / Esc 취소 — 입력창과 동일한 규칙.
export default function MessageEditModal({ isOpen, value, onChange, onSubmit, onClose }) {
  // 닫힌 동안은 '' 로 두어, 같은 메시지를 다시 열 때(value 가 그대로일 때)도 높이 계산이 다시 돌게 한다.
  const textareaRef = useAutoResizeTextarea(isOpen ? value : '', { minHeight: 140, maxHeight: 420 });

  useEscapeKey(isOpen, onClose);

  // 열릴 때 커서를 본문 맨 뒤로 (autoFocus 는 맨 앞에 두므로 직접 옮긴다)
  useEffect(() => {
    if (!isOpen) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isOpen, textareaRef]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(e);
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '1rem' }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{ backgroundColor: 'var(--surface-2)', padding: '20px', borderRadius: '8px', width: '560px', maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ margin: 0, color: 'var(--text-strong)', fontSize: '1.05rem' }}>메시지 수정</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem', lineHeight: 1 }}>✕</button>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent?.isComposing) return;
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit(e);
            }
          }}
          style={{
            width: '100%',
            padding: '12px',
            borderRadius: '6px',
            border: '1px solid var(--border-2)',
            backgroundColor: 'var(--surface-1)',
            color: 'var(--text-strong)',
            fontFamily: 'inherit',
            fontSize: '0.95rem',
            lineHeight: '1.5',
            resize: 'none',
            overflowY: 'hidden',
            outline: 'none'
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '14px' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소</span>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid var(--border-3)', backgroundColor: 'var(--border-1)', color: 'var(--text-strong)', cursor: 'pointer', fontWeight: 'bold' }}
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!value.trim()}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: value.trim() ? 'var(--accent-green)' : 'var(--border-2)', color: value.trim() ? 'var(--text-inverse)' : 'var(--text-dim)', cursor: value.trim() ? 'pointer' : 'not-allowed', fontWeight: 'bold' }}
            >
              저장
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
