import { Link, useLocation } from 'react-router-dom';

/**
 * 채팅 채널 목록 (미확인/멘션 점 표시).
 * 데스크톱 우측 사이드바 '채팅' 탭과 모바일 채팅 랜딩이 공유한다.
 */
export default function ChatChannelList({ channels, unreadChannels, onSelect }) {
  const location = useLocation();

  return (
    <div className="nav-section">
      <h3>💬 텍스트 채널</h3>
      <ul>
        {channels.map(ch => {
          const status = unreadChannels[ch.id];
          const isUnread = status && !location.pathname.includes(`/workspace/channel/${ch.id}`);
          const isMention = status === 'mention';
          return (
            <li key={ch.id}>
              <Link
                to={`/workspace/channel/${ch.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: isUnread ? 'var(--text-strong)' : 'var(--text-dim)',
                  fontWeight: isUnread ? 'bold' : 'normal'
                }}
                onClick={() => onSelect?.(ch.id)}
              >
                <span># {ch.name}</span>
                {isUnread && <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isMention ? 'var(--danger-bright)' : 'var(--text-strong)' }}></div>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
