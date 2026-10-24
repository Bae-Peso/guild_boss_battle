import { Suspense } from 'react';
import { Outlet, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import NoticeBanner from '../../components/NoticeBanner';
import './Admin.css';

export default function AdminLayout() {
  const { user, isAdmin, signOut } = useAuth();

  // 아직 로딩 중이거나 데이터를 가져오기 전일 수 있으므로 보호 처리는 App.jsx의 라우터 단에서도 병행합니다.
  if (!user || !isAdmin) {
    return <Navigate to="/" />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <NoticeBanner />
      <div className="admin-layout" style={{ flex: 1, minHeight: 0 }}>
      <aside className="admin-sidebar">
        <h2>사이트 관리 페이지</h2>
        <nav>
          <ul>
            <li><Link to="/admin">대시보드 홈</Link></li>
            <li><Link to="/admin/guilds">길드 관리</Link></li>
            <li><Link to="/admin/bosses">보스전 보스 설정</Link></li>
            <li><Link to="/admin/reports">신고/건의 센터</Link></li>
            <li><Link to="/admin/notices">사이트 전체 공지</Link></li>
            <li><Link to="/admin/users">유저 관리</Link></li>
            <li><Link to="/admin/uid-requests">UID 변경 관리</Link></li>
            <li><Link to="/admin/nikkes">니케 도감 관리</Link></li>
            <li><Link to="/admin/game-icons">게임 아이콘 관리</Link></li>
            <li><Link to="/admin/profile-images">기본 프로필 이미지 설정</Link></li>
            <li><Link to="/admin/emoticons">채팅 이모티콘 관리</Link></li>
            <li><Link to="/admin/chat-images">채팅 이미지 설정</Link></li>
            <li className="mt-auto">
              <Link to="/mypage">👤 마이페이지</Link>
            </li>
            <li style={{ marginTop: '10px' }}>
              <Link to="/">🔙 로비로 돌아가기</Link>
            </li>
            <li style={{ marginTop: '10px' }}>
              <button 
                onClick={signOut} 
                className="secondary-btn w-full" 
                style={{ color: 'var(--error)', borderColor: 'var(--error)', textAlign: 'center' }}
              >
                로그아웃
              </button>
            </li>
          </ul>
        </nav>
      </aside>
      <main className="admin-content">
        {/* 페이지별 청크 교체 시 사이드바까지 사라지지 않도록 경계를 안쪽에 둔다 */}
        <Suspense fallback={<div className="route-fallback">불러오는 중...</div>}>
          <Outlet />
        </Suspense>
      </main>
      </div>
    </div>
  );
}
