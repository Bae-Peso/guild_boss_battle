// 좌측 하단 내 카드 클릭 시 뜨는 상태 메시지 설정 모달.
export default function StatusMessageModal({ isOpen, value, onChange, onSubmit, onClose }) {
  if (!isOpen) return null;

  return (
    <div
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--surface-3)', padding: '2rem', borderRadius: '8px', width: '400px', maxWidth: '90%' }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-strong)' }}>상태 메시지 설정</h3>
        <form onSubmit={onSubmit}>
          <input
            type="text"
            value={value}
            onChange={onChange}
            placeholder="상태 메시지를 입력하세요 (예: 보스전 참여 중)"
            maxLength={50}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', marginBottom: '1.5rem', outline: 'none' }}
            autoFocus
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: '#4f545c', color: 'var(--text-strong)', cursor: 'pointer' }}>취소</button>
            <button type="submit" style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', backgroundColor: 'var(--accent-blurple)', color: 'var(--text-strong)', cursor: 'pointer' }}>저장</button>
          </div>
        </form>
      </div>
    </div>
  );
}
