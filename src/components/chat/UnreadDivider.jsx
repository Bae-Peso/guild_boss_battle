// '새로운 메시지'(안읽음 시작) 구분선 — 일반 채팅 / 지휘 채팅 공용
export default function UnreadDivider({ style }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', margin: '1.5rem 0 1rem 0', width: '100%', ...style }}>
      <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--danger-bright)' }}></div>
      <span style={{ margin: '0 10px', fontSize: '0.75rem', color: 'var(--danger-bright)', fontWeight: 'bold' }}>새로운 메시지</span>
      <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--danger-bright)' }}></div>
    </div>
  );
}
