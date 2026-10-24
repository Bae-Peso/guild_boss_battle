import { formatDateSeparator } from '../../lib/format';

// 채팅 날짜 구분선 (일반/지휘 채팅 공용).
// 해당 날짜 묶음(groupMessagesByDay)의 첫 번째 자식으로 두면, 그 날짜의 메시지가 화면에 남아 있는
// 동안 목록 최상단에 고정(sticky)되고 다음 날짜 묶음이 올라오면 밀려난다.
// background 는 메시지 목록의 배경색과 같아야 고정됐을 때 뒤 메시지가 비쳐 보이지 않는다.
// 위아래 여백은 반드시 이 컴포넌트의 padding 으로 준다 — 날짜 묶음에 padding/margin 을 주면
// 묶음이 바뀌는 순간 어느 구분선도 최상단을 덮지 않는 빈틈이 생긴다.
export default function ChatDateDivider({ date, background }) {
  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 2,
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      padding: '0.75rem 0',
      backgroundColor: background
    }}>
      <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-2)' }}></div>
      <span style={{ margin: '0 10px', fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 'bold' }}>
        {formatDateSeparator(date)}
      </span>
      <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border-2)' }}></div>
    </div>
  );
}
