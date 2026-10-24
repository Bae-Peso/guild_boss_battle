import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { useDemo } from '../../../demo/DemoContext';
import { isManager } from '../../../lib/roles';
import BossBattleNavPanel from './BossBattleNavPanel';
import ChatChannelList from './ChatChannelList';
import { navLinkStyle } from './navStyles';

/**
 * 지휘 탭의 통합 네비. 카테고리 3개를 세로로 쌓는다: 지휘 → 텍스트 채널 → 기록 조회.
 * 데스크톱 우측 사이드바 '지휘' 탭과 모바일 지휘 랜딩이 공유한다.
 *
 * 지휘 탭과 채팅 탭은 원래 따로였는데, 양쪽 다 목록이 짧아 탭을 오가는 것보다
 * 한 화면에 세로로 쌓는 편이 나아서 합쳤다.
 *
 * '기록 조회'는 지난 시즌 기록을 되짚어 보는 자리다. 지금은 결산 하나뿐이지만
 * 기록 그래프·통계가 여기 들어올 예정이라, 결산 링크 하나여도 카테고리로 세워 둔다.
 */
export default function WorkspaceNavPanel({
  guild,
  role,
  bossBattleUnread,
  channels,
  unreadChannels,
  onSelectChannel,
}) {
  const demo = useDemo();
  const admin = isManager(role);
  // 결산은 확정 전까지 관리자만 열람할 수 있다(Settlement 페이지에서 게이팅).
  // 일반 멤버에게는 볼 수 있는 결산이 하나라도 생겼을 때만 링크를 띄운다.
  const [hasFinalized, setHasFinalized] = useState(false);

  useEffect(() => {
    if (admin || demo.isDemo || !guild?.id) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('union_settlement_status')
        .select('season_name')
        .eq('union_id', guild.id)
        .eq('is_finalized', true)
        .limit(1);
      if (alive) setHasFinalized((data || []).length > 0);
    })();
    return () => { alive = false; };
  }, [admin, demo.isDemo, guild?.id]);

  const showSettlement = !demo.isDemo && (admin || hasFinalized);

  return (
    <>
      <BossBattleNavPanel role={role} bossBattleUnread={bossBattleUnread} />

      <ChatChannelList
        channels={channels}
        unreadChannels={unreadChannels}
        onSelect={onSelectChannel}
      />

      {/* 결산이 유일한 항목이라 볼 게 없으면 카테고리째 숨긴다(빈 제목만 남는 걸 방지). */}
      {showSettlement && (
        <div className="nav-section">
          <h3>📊 기록 조회</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0' }}>
            <li style={{ marginBottom: '8px' }}>
              <Link to="/workspace/settlement" style={navLinkStyle}>
                결산
              </Link>
            </li>
          </ul>
        </div>
      )}
    </>
  );
}
