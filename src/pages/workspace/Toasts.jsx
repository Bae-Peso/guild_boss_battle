// 우측 상단 알림 토스트 스택 (멘션/지휘 오더 알림 등).
export default function Toasts({ toasts }) {
  return (
    <>
      <div style={{ position: 'fixed', top: '20px', left: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            background: 'rgba(25, 25, 25, 0.95)',
            borderLeft: '4px solid var(--danger-strong)',
            color: 'var(--text-strong)',
            padding: '15px 20px',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            minWidth: '250px',
            animation: 'fadeIn 0.3s ease-in-out'
          }}>
            <div style={{ fontWeight: 'bold', marginBottom: '5px', color: 'var(--accent-amber)', fontSize: '0.85rem' }}>🔔 알림</div>
            <div style={{ fontSize: '0.9rem', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>{toast.message}</div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
