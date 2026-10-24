import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { GameDataProvider } from './contexts/GameDataContext';
import { DemoProvider } from './demo/DemoContext';
import Login from './pages/Login';
import { supabase, ensureSession, withRetry, unwrap } from './lib/supabase';
import { lazyRoute } from './lib/lazyRoute';
import './index.css';

/* ── 라우트 단위 코드 스플리팅 ─────────────────────────────────────────────
 * 예전에는 admin 백오피스 13개 페이지까지 전부 하나의 청크(944 KB)에 들어 있어서,
 * 로그인 화면만 보는 사람도 관리자 화면을 통째로 내려받아야 했다.
 *
 * Login만 정적으로 남긴다. 비로그인 방문자의 유일한 목적지이자 가장 작은 화면이라,
 * 이걸 lazy로 돌리면 첫 화면을 위해 왕복만 한 번 더 늘어난다.
 * ──────────────────────────────────────────────────────────────────────── */

// lazyRoute = React.lazy + 배포 직후 청크 유실 자동 복구 + preload
// (lib/lazyRoute.js 주석 참고). preload를 쓰는 이유는 파일 하단에 적어뒀다.
const SignUp = lazyRoute(() => import('./pages/SignUp'));
const Lobby = lazyRoute(() => import('./pages/Lobby'));
const MyPage = lazyRoute(() => import('./pages/MyPage'));
const Terms = lazyRoute(() => import('./pages/Terms'));

const AdminLayout = lazyRoute(() => import('./pages/admin/AdminLayout'));
const DashboardHome = lazyRoute(() => import('./pages/admin/DashboardHome'));
const GuildManagement = lazyRoute(() => import('./pages/admin/GuildManagement'));
const GlobalBosses = lazyRoute(() => import('./pages/admin/GlobalBosses'));
const Reports = lazyRoute(() => import('./pages/admin/Reports'));
const UserManagement = lazyRoute(() => import('./pages/admin/UserManagement'));
const AuditLogs = lazyRoute(() => import('./pages/admin/AuditLogs'));
const UidRequests = lazyRoute(() => import('./pages/admin/UidRequests'));
const NikkeManagement = lazyRoute(() => import('./pages/admin/NikkeManagement'));
const GameIconsManagement = lazyRoute(() => import('./pages/admin/GameIconsManagement'));
const ProfileImageManagement = lazyRoute(() => import('./pages/admin/ProfileImageManagement'));
const EmoticonManagement = lazyRoute(() => import('./pages/admin/EmoticonManagement'));
const ChatImageSettings = lazyRoute(() => import('./pages/admin/ChatImageSettings'));
const SiteNotices = lazyRoute(() => import('./pages/admin/SiteNotices'));

const WorkspaceLayout = lazyRoute(() => import('./pages/workspace/WorkspaceLayout'));
const GuildSettings = lazyRoute(() => import('./pages/workspace/GuildSettings'));
const WorkspaceChat = lazyRoute(() => import('./pages/workspace/WorkspaceChat'));
const BossBattleDashboard = lazyRoute(() => import('./pages/workspace/BossBattleDashboard'));
const MockBattleDashboard = lazyRoute(() => import('./pages/workspace/MockBattleDashboard'));
const GuildBossBattleStatus = lazyRoute(() => import('./pages/workspace/GuildBossBattleStatus'));
const BossBattleChatPage = lazyRoute(() => import('./pages/workspace/BossBattleChatPage'));
const Settlement = lazyRoute(() => import('./pages/workspace/Settlement'));
const SettlementBoss = lazyRoute(() => import('./pages/workspace/SettlementBoss'));

// supabase는 세션을 `sb-<project-ref>-auth-token` 키로 localStorage에 둔다.
// 동기 조회라 부팅을 막지 않는다.
function hasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) return true;
    }
  } catch {
    // 프라이빗 모드 등에서 localStorage 접근이 막힐 수 있다. 못 읽으면 preload를 건너뛴다.
  }
  return false;
}

// lazy 청크는 라우트가 매치돼야 요청이 나간다. 그런데 AuthProvider가 세션을
// 확인하는 동안에는 라우트가 아직 안 걸리므로, 로그인 사용자에겐 "인증 왕복 →
// 청크 다운로드"가 직렬로 쌓인다. 세션이 있으면 어차피 갈 곳이 정해져 있으니
// 인증 왕복과 병렬로 미리 받아 그 직렬화를 상쇄한다.
// 빗나가도 백그라운드 요청 하나가 낭비될 뿐, 아무것도 막지 않는다.
if (hasStoredSession()) {
  if (window.location.pathname.startsWith('/admin')) AdminLayout.preload();
  else WorkspaceLayout.preload();
}

const PrivateRoute = ({ children }) => {
  const { user, globalBanReason } = useAuth();
  
  if (!user) return <Navigate to="/login" />;
  if (globalBanReason) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ color: 'var(--error)', marginBottom: '1rem' }}>⛔ 이용이 제한된 계정입니다.</h1>
        <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>차단 사유: <strong style={{ color: 'var(--accent-amber)' }}>{globalBanReason}</strong></p>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>사이트 운영 원칙 위반으로 인해 서비스 이용이 영구 제한되었습니다.</p>
        <button onClick={() => supabase.auth.signOut()} style={{ padding: '10px 20px', backgroundColor: 'var(--accent-blurple)', border: 'none', color: 'var(--text-strong)', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }}>
          로그아웃
        </button>
      </div>
    );
  }
  return children;
};

const RootRedirect = () => {
  const { user, isAdmin, globalBanReason } = useAuth();
  const [loading, setLoading] = useState(true);
  const [hasGuild, setHasGuild] = useState(false);

  useEffect(() => {
    let alive = true;
    const checkGuild = async () => {
      if (user && !isAdmin && !globalBanReason) {
        try {
          // 이 조회가 조용히 실패하면 길드가 있는 사용자도 로비로 떨어져
          // "가입한 길드가 사라진" 것처럼 보인다. 세션을 보장하고 재시도한다.
          await ensureSession();
          const data = await withRetry(async () => unwrap(
            await supabase
              .from('union_members')
              .select('union_id')
              .eq('user_id', user.id)
              .eq('join_status', 'approved')
              .maybeSingle(),
            'union_members',
          ), { label: 'root-redirect' });

          if (alive && data) setHasGuild(true);
        } catch (err) {
          console.error('소속 길드 확인 실패:', err);
        }
      }
      if (alive) setLoading(false);
    };
    checkGuild();
    return () => { alive = false; };
  }, [user, isAdmin, globalBanReason]);

  if (!user) return <Navigate to="/login" />;
  if (globalBanReason) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', padding: '2rem', textAlign: 'center' }}>
        <h1 style={{ color: 'var(--error)', marginBottom: '1rem' }}>⛔ 이용이 제한된 계정입니다.</h1>
        <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>차단 사유: <strong style={{ color: 'var(--accent-amber)' }}>{globalBanReason}</strong></p>
        <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>사이트 운영 원칙 위반으로 인해 서비스 이용이 영구 제한되었습니다.</p>
        <button onClick={() => supabase.auth.signOut()} style={{ padding: '10px 20px', backgroundColor: 'var(--accent-blurple)', border: 'none', color: 'var(--text-strong)', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }}>
          로그아웃
        </button>
      </div>
    );
  }
  if (isAdmin) return <Navigate to="/admin" />;
  if (loading) return <div className="app-container text-center mt-5" style={{ color: 'var(--text-muted)' }}>소속 길드 확인 중...</div>;
  if (hasGuild) return <Navigate to="/workspace" />;
  
  return <Lobby />;
};

function AppRoutes() {
  const { user } = useAuth();
  
  // 최상위 경계는 셸(WorkspaceLayout / AdminLayout) 자체를 받아오는 동안만 쓰인다.
  // 셸 하위 라우트는 각 레이아웃 안쪽의 경계가 처리한다 — 그래야 탭을 옮길 때
  // 레이아웃이 언마운트되지 않고, realtime 구독 10여 개가 살아남는다.
  return (
    <Suspense fallback={<div className="app-boot">불러오는 중...</div>}>
    <Routes>
      <Route path="/login" element={user ? <RootRedirect /> : <Login />} />
      <Route path="/signup" element={user ? <RootRedirect /> : <SignUp />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/" element={<RootRedirect />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<DashboardHome />} />
        <Route path="guilds" element={<GuildManagement />} />
        <Route path="bosses" element={<GlobalBosses />} />
        <Route path="reports" element={<Reports />} />
        <Route path="users" element={<UserManagement />} />
        <Route path="uid-requests" element={<UidRequests />} />
        <Route path="nikkes" element={<NikkeManagement />} />
        <Route path="game-icons" element={<GameIconsManagement />} />
        <Route path="profile-images" element={<ProfileImageManagement />} />
        <Route path="emoticons" element={<EmoticonManagement />} />
        <Route path="chat-images" element={<ChatImageSettings />} />
        <Route path="notices" element={<SiteNotices />} />
        <Route path="logs" element={<AuditLogs />} />
      </Route>
      <Route path="/mypage" element={<PrivateRoute><MyPage /></PrivateRoute>} />
      <Route path="/workspace" element={<PrivateRoute><WorkspaceLayout /></PrivateRoute>}>
        <Route index element={<div style={{ padding: '3rem', color: 'var(--text-muted)', textAlign: 'center' }}>우측에서 채널을 선택해주세요.</div>} />
        <Route path="channel/:channelId" element={<WorkspaceChat />} />
        <Route path="settings" element={<GuildSettings />} />
        <Route path="boss-battle-dashboard" element={<BossBattleDashboard />} />
        <Route path="mock-battles" element={<MockBattleDashboard />} />
        <Route path="guild-boss-battle-status" element={<GuildBossBattleStatus />} />
        <Route path="boss-battle-chat" element={<BossBattleChatPage />} />
        <Route path="settlement" element={<Settlement />} />
        <Route path="settlement/boss/:bossNumber" element={<SettlementBoss />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <AuthProvider>
      <GameDataProvider>
        <Router>
          <DemoProvider>
            <AppRoutes />
          </DemoProvider>
        </Router>
      </GameDataProvider>
    </AuthProvider>
  );
}

export default App;
