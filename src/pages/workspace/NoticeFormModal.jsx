// 길드 공지 작성 모달 (내용 + 내리는 일시).
export default function NoticeFormModal({ isOpen, content, onContentChange, expiresAt, onExpiresAtChange, onSubmit, onCancel }) {
  if (!isOpen) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
      <div style={{ backgroundColor: 'var(--surface-2)', padding: '20px', borderRadius: '8px', width: '500px', maxWidth: '90%' }}>
        <h3 style={{ margin: '0 0 15px 0', color: 'var(--text-strong)' }}>신규 공지사항 작성</h3>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>공지 내용 (한 줄 권장)</label>
            <input
              type="text"
              value={content}
              onChange={onContentChange}
              placeholder="예: 이번 시즌은 내일부터 시작됩니다!"
              required
              style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-1)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: 'var(--text-muted)' }}>공지 내리는 일시 (이 시각이 지나면 자동으로 내려갑니다)</label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={onExpiresAtChange}
              required
              style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-1)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel} style={{ padding: '8px 15px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
            <button type="submit" style={{ padding: '8px 15px', background: 'var(--accent-green)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>작성하기</button>
          </div>
        </form>
      </div>
    </div>
  );
}
