import { Link } from 'react-router-dom';
import { isManager } from '../../../lib/roles';
import { navLinkStyle } from './navStyles';

/**
 * '지휘' 카테고리: 타수 현황판 / 지휘 현황판 / 지휘 채팅방 링크.
 * 통합 네비(WorkspaceNavPanel)의 맨 위 블록으로만 쓰인다.
 *
 * 결산 링크는 원래 여기 마지막 항목이었지만, 지휘 툴 블록보다 훨씬 뜸하게 쓰여서
 * '기록 조회' 카테고리로 분리해 텍스트 채널 아래로 내렸다 → WorkspaceNavPanel이 들고 있다.
 *
 * 지휘 채팅은 예전에 이 패널 안에 항상 펼쳐져 있었지만 실제로 그렇게는 쓰이지 않아,
 * 보스 현황과 함께 보는 전용 화면(/workspace/boss-battle-chat)으로 옮기고 여기엔 버튼만 남겼다.
 * 채팅이 상시 마운트되지 않게 되어, 안읽음은 이 버튼의 점으로만 알 수 있다 → 점을 꼭 유지할 것.
 */
export default function BossBattleNavPanel({ role, bossBattleUnread, onSelect }) {
  const admin = isManager(role);

  // 관리자 방의 안읽음은 관리자에게만 의미가 있다(일반 멤버는 애초에 그 방을 못 본다).
  const chatUnread = bossBattleUnread?.general || (admin && bossBattleUnread?.admin) || false;
  const chatMention = bossBattleUnread?.general === 'mention' || (admin && bossBattleUnread?.admin === 'mention');

  return (
    <div className="nav-section">
      {/* 카테고리 제목은 .nav-section h3 기본색(회색)으로 통일 — 텍스트 채널/기록 조회와 같은 급이다. */}
      <h3>⚔️ 지휘</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0' }}>
        <li style={{ marginBottom: '8px' }}>
          <Link to="/workspace/guild-boss-battle-status" onClick={onSelect} style={navLinkStyle}>
            타수 현황판
          </Link>
        </li>
        <li style={{ marginBottom: '8px' }}>
          <Link to="/workspace/boss-battle-dashboard" onClick={onSelect} style={navLinkStyle}>
            지휘 현황판
          </Link>
        </li>
        <li style={{ marginBottom: '8px' }}>
          {/* 지휘 중 가장 자주 드나드는 곳이라 은은하게 띄운다. 크기·모양은 다른 항목과 똑같이 두고
              파란 기운만 얹은 배경 + 왼쪽 얇은 바로만 구분한다(원색으로 칠하면 결산의 노란 버튼 꼴이 된다). */}
          <Link
            to="/workspace/boss-battle-chat"
            onClick={onSelect}
            style={{
              ...navLinkStyle,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              backgroundColor: 'var(--accent-blue-soft)',
              boxShadow: 'inset 3px 0 0 var(--accent-blue-dim)',
            }}
          >
            지휘 채팅방
            {chatUnread && (
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, backgroundColor: chatMention ? 'var(--danger-strong)' : 'var(--text-strong)' }}></span>
            )}
          </Link>
        </li>
      </ul>
    </div>
  );
}
