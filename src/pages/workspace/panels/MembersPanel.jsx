import { Link } from 'react-router-dom';
import MemberRow from '../MemberRow';
import { isManager } from '../../../lib/roles';

/**
 * 인원 현황 패널: 온라인/오프라인 멤버 목록 + 내 프로필/상태/마이페이지/길드 설정/로그아웃.
 * 데스크톱 좌측 사이드바와 모바일 三 드로어가 공유한다.
 * 상단 헤더(길드명/접기·닫기)는 호스트가 담당하고, 이 컴포넌트는 목록 + 푸터만 렌더한다.
 */
export default function MembersPanel({
  user,
  role,
  inGameName,
  statusMessage,
  synchroLevel,
  allMembers,
  onlineUsers,
  profileImagesMap,
  pendingRequestsCount,
  onStatusClick,
  onSettingsClick,
  onSignOut,
  onNavigate,
}) {
  const myProfileImageId = allMembers.find(m => m.user_id === user?.id)?.users?.profile_image_id;

  return (
    <>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 1rem 0', textTransform: 'uppercase' }}>
          온라인 — {Object.keys(onlineUsers).length}
        </h3>
        {allMembers.filter(m => onlineUsers[m.user_id]).map(m => (
          <MemberRow key={m.user_id} member={m} online profileImagesMap={profileImagesMap} />
        ))}

        <h3 style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '1.5rem 0 1rem 0', textTransform: 'uppercase' }}>
          오프라인 — {allMembers.length - Object.keys(onlineUsers).length}
        </h3>
        {allMembers.filter(m => !onlineUsers[m.user_id]).map(m => (
          <MemberRow key={m.user_id} member={m} online={false} profileImagesMap={profileImagesMap} />
        ))}
      </div>

      <footer className="workspace-footer" style={{ marginTop: 'auto', padding: '15px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 15px', backgroundColor: 'var(--surface-1)', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s' }}
          onClick={onStatusClick}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--surface-1)'}
        >
          <div style={{ position: 'relative' }}>
            {myProfileImageId && profileImagesMap[myProfileImageId] ? (
              <img src={profileImagesMap[myProfileImageId]} alt={inGameName} style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: 'var(--accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-strong)', fontWeight: 'bold', fontSize: '1.2rem' }}>
                {inGameName ? inGameName.charAt(0).toUpperCase() : '?'}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: -2, right: -2, width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--accent-green)', border: '2px solid var(--surface-1)' }}></div>
          </div>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <div style={{ color: 'var(--text-strong)', fontSize: '0.95rem', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {inGameName}
              {role === 'admin' && <span style={{ marginLeft: '4px' }}>🟧</span>}
              {role === 'sub_admin' && <span style={{ marginLeft: '4px' }}>🟦</span>}
              {synchroLevel && <span style={{ marginLeft: '4px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>({synchroLevel})</span>}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {statusMessage ? statusMessage : '상태 설정 (클릭)'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <Link to="/mypage" onClick={onNavigate} className="settings-btn" style={{ backgroundColor: '#4f545c', border: 'none', color: 'var(--text-strong)', padding: '10px', textAlign: 'center', borderRadius: '4px' }}>👤 마이페이지</Link>
          {isManager(role) && (
            <button onClick={onSettingsClick} className="settings-btn" style={{ position: 'relative', padding: '10px', textAlign: 'center', borderRadius: '4px', backgroundColor: 'var(--surface-3)', color: 'var(--text-strong)', border: '1px solid #4f545c', cursor: 'pointer' }}>
              ⚙️ 길드 설정
              {pendingRequestsCount > 0 && (
                <div style={{ position: 'absolute', top: '-5px', right: '-5px', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--danger-strong)' }}></div>
              )}
            </button>
          )}
          <button onClick={onSignOut} className="secondary-btn w-full" style={{ borderColor: 'var(--border-2)', color: 'var(--text-dim)', fontSize: '0.85rem', padding: '10px', marginTop: '10px' }}>
            로그아웃
          </button>
        </div>
      </footer>
    </>
  );
}
