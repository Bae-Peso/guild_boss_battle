import { useEffect, useState, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import MembersPanel from './panels/MembersPanel';
import WorkspaceNavPanel from './panels/WorkspaceNavPanel';
import MockBossNav from './panels/MockBossNav';

/**
 * 좁은 화면(≤820px) 전용 워크스페이스 셸.
 * 3분할 대신 단일 화면 콘텐츠 + 하단 고정 탭 바(三·지휘·모의전) + 인원 드로어.
 * 데이터/실시간 로직은 WorkspaceLayout에 그대로 두고, 이 컴포넌트는 표현/네비게이션만 담당한다.
 * 라우트는 유지 — 하단 탭 = 섹션, 섹션 안에서 목록(랜딩) ↔ 상세(라우트 페이지)의 master-detail.
 */
export default function WorkspaceMobileShell({
  guild,
  role,
  user,
  inGameName,
  statusMessage,
  synchroLevel,
  channels,
  allMembers,
  onlineUsers,
  profileImagesMap,
  unreadChannels,
  setUnreadChannels,
  bossBattleUnread,
  pendingRequestsCount,
  isAnyChatUnread,
  isAnyChatMentioned,
  isBossBattleUnread,
  isBossBattleMention,
  outletContext,
  onStatusClick,
  onSettingsClick,
  onSignOut,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  // 'bossBattle' 랜딩 하나가 지휘 툴 + 텍스트 채널 + 결산을 모두 담는다(데스크톱 우측 사이드바와 동일).
  const [landingTab, setLandingTab] = useState('bossBattle');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const path = location.pathname;
  const isChannel = /\/workspace\/channel\//.test(path);
  // 결산(/settlement, /settlement/boss/:n)과 지휘 채팅방(/boss-battle-chat)도 지휘 섹션의 상세 화면이다.
  // 빠지면 그쪽으로 이동해도 셸이 랜딩을 계속 그려 페이지가 안 보인다.
  const isBossBattleDetail = path.includes('/guild-boss-battle-status') || path.includes('/boss-battle-dashboard')
    || path.includes('/settlement') || path.includes('/boss-battle-chat');
  const isMockDetail = path.includes('/mock-battles');
  const isDetail = isChannel || isBossBattleDetail || isMockDetail;

  // 현재 위치에서 하단 탭 하이라이트 결정 (상세 라우트면 그 섹션, 아니면 선택된 랜딩 탭)
  // 텍스트 채널도 이제 지휘 섹션 소속이라 채널 상세에서 '지휘'가 켜진다.
  let activeTab = landingTab;
  if (isChannel || isBossBattleDetail) activeTab = 'bossBattle';
  else if (isMockDetail) activeTab = 'mock';

  // 라우트가 바뀌면 인원 드로어 자동 닫힘
  useEffect(() => { setDrawerOpen(false); }, [path]);

  // 드로어 열림 동안 배경 스크롤 잠금
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  useEscapeKey(drawerOpen, () => setDrawerOpen(false));

  const goTab = (tab) => {
    if (tab === 'members') { setDrawerOpen(true); return; }
    setLandingTab(tab);
    navigate('/workspace');
  };

  const goBack = () => {
    setLandingTab(activeTab);
    navigate('/workspace');
  };

  const renderLanding = () => (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem' }}>
      {activeTab === 'mock' ? (
        <MockBossNav guild={guild} onSelectBoss={(bossNum) => navigate(`/workspace/mock-battles?bossNum=${bossNum}`)} />
      ) : (
        <WorkspaceNavPanel
          guild={guild}
          role={role}
          bossBattleUnread={bossBattleUnread}
          channels={channels}
          unreadChannels={unreadChannels}
          onSelectChannel={(id) => setUnreadChannels(prev => ({ ...prev, [id]: false }))}
        />
      )}
    </div>
  );

  // 지휘 탭이 채팅까지 품으므로 배지도 지휘/채팅 안읽음을 합쳐서 표시한다.
  const tabs = [
    { key: 'members', label: '인원', icon: '☰' },
    { key: 'bossBattle', label: '지휘', icon: '⚔️', unread: isBossBattleUnread || isAnyChatUnread, mention: isBossBattleMention || isAnyChatMentioned },
    { key: 'mock', label: '모의전', icon: '🎯' },
  ];

  // 상세 화면에선 페이지 자체 헤더가 있으므로 셸 상단바를 생략(이중 헤더/빈 공간 제거).
  // 대신 leftCollapsed=true로 넘겨 기존 --panel-collapse-inset 여백을 재사용, 떠 있는 뒤로가기 버튼과 안 겹치게 한다.
  const detailCtx = isDetail ? { ...outletContext, leftCollapsed: true } : outletContext;

  return (
    <div className="mobile-shell">
      {!isDetail && (
        <header className="mobile-topbar">
          <button className="mobile-back-btn" onClick={() => setDrawerOpen(true)} aria-label="인원 메뉴 열기">☰</button>
          <h2 className="mobile-topbar-title">{guild?.name}</h2>
          <span className="guild-code">#{guild?.union_code}</span>
        </header>
      )}

      <main className="mobile-content">
        {isDetail ? (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', paddingTop: 'env(safe-area-inset-top)' }}>
            {/* 뒤로가기 버튼은 스크롤 밖(고정), 콘텐츠만 세로 스크롤 */}
            <button className="mobile-back-fab" onClick={goBack} aria-label="뒤로">‹</button>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
              {/* 데스크톱 셸과 같은 이유로 경계가 셸 안쪽에 있어야 한다 (WorkspaceLayout 주석 참고) */}
              <Suspense fallback={<div className="route-fallback">불러오는 중...</div>}>
                <Outlet context={detailCtx} />
              </Suspense>
            </div>
          </div>
        ) : renderLanding()}
      </main>

      <nav className="mobile-tabbar">
        {tabs.map(t => (
          <button
            key={t.key}
            className={`mobile-tab ${activeTab === t.key ? 'active' : ''}`}
            onClick={() => goTab(t.key)}
          >
            <span className="mobile-tab-icon">
              {t.icon}
              {t.unread && (
                <span className="mobile-tab-badge" style={{ backgroundColor: t.mention ? 'var(--danger-strong)' : 'var(--text-strong)' }}></span>
              )}
            </span>
            <span className="mobile-tab-label">{t.label}</span>
          </button>
        ))}
      </nav>

      {drawerOpen && (
        <>
          <div className="mobile-drawer-scrim" onClick={() => setDrawerOpen(false)} />
          <aside className="mobile-drawer">
            <header className="mobile-drawer-header">
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{guild?.name}</h2>
                <span className="guild-code">#{guild?.union_code}</span>
              </div>
              <button className="mobile-back-btn" onClick={() => setDrawerOpen(false)} aria-label="닫기">✕</button>
            </header>
            <MembersPanel
              user={user}
              role={role}
              inGameName={inGameName}
              statusMessage={statusMessage}
              synchroLevel={synchroLevel}
              allMembers={allMembers}
              onlineUsers={onlineUsers}
              profileImagesMap={profileImagesMap}
              pendingRequestsCount={pendingRequestsCount}
              onStatusClick={() => { setDrawerOpen(false); onStatusClick(); }}
              onSettingsClick={() => { setDrawerOpen(false); onSettingsClick(); }}
              onSignOut={onSignOut}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </>
      )}
    </div>
  );
}
