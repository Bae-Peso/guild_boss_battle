import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import AvatarSettings from '../components/AvatarSettings';
import ReportModal from '../components/ReportModal';
import TermsModal from '../components/TermsModal';
import NoticeBanner from '../components/NoticeBanner';
import { playMentionSound } from '../lib/sound';
import { getPushStatus, subscribeToPush, unsubscribeFromPush } from '../lib/push';
import { OPERATOR_NAME } from '../lib/siteLinks';

const PROFILE_IMAGES_PER_PAGE = 24;

export default function MyPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [guildName, setGuildName] = useState('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isTermsOpen, setIsTermsOpen] = useState(false);

  // 알림 설정 state
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem('mentionSoundEnabled') !== 'false'
  );

  // Web Push 구독 상태: loading | unsupported | denied | subscribed | unsubscribed
  const [pushStatus, setPushStatus] = useState('loading');
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    getPushStatus().then(setPushStatus).catch(() => setPushStatus('unsupported'));
  }, []);

  // 프로필 이미지 state
  const [profileImages, setProfileImages] = useState([]);
  const [selectedProfileImageId, setSelectedProfileImageId] = useState(null);
  const [profileImageLoading, setProfileImageLoading] = useState(false);
  const [profileSearch, setProfileSearch] = useState('');
  const [profilePage, setProfilePage] = useState(1);

  // 닉네임 변경 state
  const [newNickname, setNewNickname] = useState('');
  const [nickLoading, setNickLoading] = useState(false);
  const [pendingNickRequest, setPendingNickRequest] = useState(null);

  // 비밀번호 변경 state
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // UID 변경 신청 state
  const [newUid, setNewUid] = useState('');
  const [uidLoading, setUidLoading] = useState(false);
  const [pendingUidRequest, setPendingUidRequest] = useState(null);

  const fetchData = async () => {
    setLoading(true);
    // Fetch users info (UID, etc)
    const { data: uData } = await supabase.from('users').select('*').eq('id', user.id).single();

    // Fetch in-game name and guild membership
    // 승인된(approved) 소속을 우선, 없으면 신청 중(pending)을 사용. 차단(banned)/거절(rejected) 이력은 소속으로 취급하지 않음.
    const { data: memberships } = await supabase
      .from('union_members')
      .select('id, in_game_name, union_id, role, join_status')
      .eq('user_id', user.id);
    const mData =
      (memberships || []).find(m => m.join_status === 'approved') ||
      (memberships || []).find(m => m.join_status === 'pending') ||
      null;
    const inGameName = mData?.in_game_name || '등록된 닉네임 없음';

    setUserData({ ...uData, in_game_name: inGameName, union_id: mData?.union_id || null, guild_role: mData?.role });

    // Check pending UID requests
    const { data: rData } = await supabase
      .from('uid_change_requests')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (rData) setPendingUidRequest(rData);

    // Check pending Nickname requests
    const { data: nData } = await supabase
      .from('union_nickname_requests')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (nData) setPendingNickRequest(nData);

    // Fetch profile images
    const { data: pImages } = await supabase.from('profile_images').select('*').order('name', { ascending: true });
    if (pImages) setProfileImages(pImages);

    setSelectedProfileImageId(uData?.profile_image_id || null);

    setLoading(false);
  };

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  const handleProfileImageSelect = async (imageId) => {
    setProfileImageLoading(true);
    const { error } = await supabase
      .from('users')
      .update({ profile_image_id: imageId })
      .eq('id', user.id);

    if (error) {
      console.error(error);
      alert('프로필 이미지 변경 실패: ' + error.message);
    } else {
      setSelectedProfileImageId(imageId);
      alert('프로필 이미지가 변경되었습니다.');
    }
    setProfileImageLoading(false);
  };

  const handleToggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    localStorage.setItem('mentionSoundEnabled', newValue.toString());

    if (newValue) {
      playMentionSound({ volume: 1.0 }).catch(() => { });
    }
  };

  const handleTogglePush = async () => {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      if (pushStatus === 'subscribed') {
        await unsubscribeFromPush();
        setPushStatus('unsubscribed');
      } else {
        await subscribeToPush(user.id);
        setPushStatus('subscribed');
        alert('백그라운드 푸시 알림이 활성화되었습니다.\n이제 브라우저를 닫아도 멘션 알림을 받을 수 있습니다.');
      }
    } catch (e) {
      if (e.message === 'permission_denied') {
        setPushStatus(Notification.permission === 'denied' ? 'denied' : 'unsubscribed');
        alert('브라우저 알림 권한이 거부되어 푸시를 켤 수 없습니다.\n주소창의 사이트 설정에서 알림 권한을 허용해주세요.');
      } else {
        console.error(e);
        alert('푸시 설정 중 오류가 발생했습니다: ' + e.message);
      }
    }
    setPushLoading(false);
  };

  const handleTestNotification = () => {
    // 1. 소리 테스트
    if (soundEnabled) {
      playMentionSound({ volume: 0.8 }).catch(e => {
        console.error(e);
        alert('브라우저 정책에 의해 소리 재생이 차단되었습니다. 페이지 빈 공간을 클릭한 후 다시 시도해보세요.');
      });
    } else {
      alert('소리 알림이 OFF 상태입니다.');
    }

    // 2. 브라우저 알림 테스트
    if (Notification.permission === 'granted') {
      new Notification('길드 보스전 지휘소 (테스트)', {
        body: '테스트 알림이 정상적으로 수신되었습니다!',
        icon: '/favicon.ico'
      });
    } else {
      alert(`브라우저 알림 권한이 없습니다. (현재 상태: ${Notification.permission})`);
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  };

  const handleNicknameChange = async (e) => {
    e.preventDefault();
    if (newNickname.length === 0 || newNickname.length > 8) {
      alert('인게임 닉네임은 1~8글자로 입력해주세요.');
      return;
    }
    if (!window.confirm(`소속된 길드의 관리자에게 닉네임 변경 요청이 전송됩니다. '${newNickname}'(으)로 변경을 요청하시겠습니까?`)) return;

    setNickLoading(true);

    const { data: userGuilds } = await supabase.from('union_members').select('union_id').eq('user_id', user.id).in('join_status', ['approved', 'pending']);

    if (!userGuilds || userGuilds.length === 0) {
      alert('소속된 길드가 없습니다.');
      setNickLoading(false);
      return;
    }

    const inserts = userGuilds.map(u => ({
      union_id: u.union_id,
      user_id: user.id,
      old_nickname: userData?.in_game_name || '',
      new_nickname: newNickname,
      status: 'pending'
    }));

    const { error } = await supabase.from('union_nickname_requests').insert(inserts);

    if (error) {
      alert('닉네임 변경 요청 중 오류가 발생했습니다.');
      console.error(error);
    } else {
      alert('닉네임 변경 요청이 성공적으로 전송되었습니다.');
      setNewNickname('');
      fetchData();
    }
    setNickLoading(false);
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPassword !== newPasswordConfirm) {
      alert('새 비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }
    if (newPassword.length < 6) {
      alert('비밀번호는 최소 6자 이상이어야 합니다.');
      return;
    }

    setPwLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      alert('비밀번호 변경 실패: ' + error.message);
    } else {
      alert('비밀번호가 성공적으로 변경되었습니다.');
      setNewPassword('');
      setNewPasswordConfirm('');
    }
    setPwLoading(false);
  };

  const handleUidRequest = async (e) => {
    e.preventDefault();
    if (newUid.length !== 8) {
      alert('UID는 정확히 8자리 숫자여야 합니다.');
      return;
    }
    // 이미 다른 계정이 점유한 UID로는 변경 신청 불가 (승인 단계에서 UNIQUE 제약으로 거부되므로 사전 차단)
    const { data: uidTaken } = await supabase.rpc('is_uid_taken', { p_uid: newUid });
    if (uidTaken) {
      alert('이미 다른 계정에서 사용 중인 인게임 UID입니다. 변경 신청할 수 없습니다.');
      return;
    }
    if (!window.confirm('UID 변경 신청을 접수하시겠습니까?\n※ 허위 UID를 입력하여 혼란을 초래할 경우, 사이트 관리자에 의해 영구 차단될 수 있습니다.')) return;

    setUidLoading(true);
    const { data, error } = await supabase
      .from('uid_change_requests')
      .insert({
        user_id: user.id,
        old_uid: userData?.uid || null,
        new_uid: newUid,
        status: 'pending'
      }).select().single();

    if (error) {
      console.error(error);
      alert('신청 접수 중 오류가 발생했습니다: ' + error.message);
    } else {
      alert('UID 변경 신청이 접수되었습니다.');
      setPendingUidRequest(data);
    }
    setUidLoading(false);
  };

  const handleLeaveGuild = async () => {
    if (!window.confirm('정말 길드에서 탈퇴하시겠습니까?\n탈퇴 시 길드 멤버 목록에서 즉시 제외되며, 다시 가입하려면 가입 신청을 새로 해야 합니다.')) return;
    if (!userData?.union_id) return;
    setLoading(true);
    // 현재 소속 길드의 멤버십만 삭제 (다른 길드의 차단/신청 이력은 보존)
    const { error } = await supabase.from('union_members').delete().eq('user_id', user.id).eq('union_id', userData.union_id);
    if (error) {
      alert('탈퇴 중 오류가 발생했습니다: ' + error.message);
      setLoading(false);
    } else {
      alert('길드에서 탈퇴되었습니다.');
      fetchData();
    }
  };

  // 프로필 이미지 검색 + 페이지네이션 (이미지가 많을 수 있어 4행씩 나눠 표시)
  // 니케 검색처럼 이름뿐 아니라 축약어(aliases)로도 검색되게 한다.
  const profileQuery = profileSearch.trim().toLowerCase();
  const filteredProfileImages = profileImages.filter(img =>
    (img.name || '').toLowerCase().includes(profileQuery) ||
    (img.aliases || '').toLowerCase().includes(profileQuery)
  );
  const profileTotalPages = Math.max(1, Math.ceil(filteredProfileImages.length / PROFILE_IMAGES_PER_PAGE));
  const currentProfilePage = Math.min(profilePage, profileTotalPages);
  const pagedProfileImages = filteredProfileImages.slice(
    (currentProfilePage - 1) * PROFILE_IMAGES_PER_PAGE,
    currentProfilePage * PROFILE_IMAGES_PER_PAGE
  );

  if (loading) return <div className="app-container text-center mt-5" style={{ color: 'var(--text-muted)' }}>정보를 불러오는 중...</div>;

  return (
    <>
      <NoticeBanner />
      <div className="app-container" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', marginBottom: '2rem' }}>
          <h1 style={{ margin: 0, color: 'var(--text-strong)' }}>마이페이지</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setIsReportModalOpen(true)}
              style={{ padding: '6px 16px', background: 'rgba(255, 193, 7, 0.15)', color: 'var(--accent-amber)', border: '1px solid var(--accent-amber)', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}
            >
              🚨 버그 제보 / 기능 건의
            </button>
            <button onClick={() => navigate(-1)} className="secondary-btn">뒤로 가기</button>
          </div>
        </header>

        <div className="lobby-card" style={{ marginBottom: '2.5rem', backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-2)', display: 'flex', flexDirection: 'column', gap: '15px', padding: '2rem' }}>
          <h3 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.8rem', margin: 0 }}>내 프로필 정보</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
            <span style={{ color: 'var(--text-muted)' }}>사이트 가입 계정 (ID)</span>
            <span style={{ color: 'var(--text-strong)', fontWeight: 'bold' }}>{userData?.username}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>인게임 닉네임</span>
            <span style={{ color: 'var(--text-strong)', fontWeight: 'bold' }}>{userData?.in_game_name}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>인게임 UID</span>
            <span style={{ color: 'var(--accent-amber)', fontWeight: 'bold' }}>{userData?.uid || '미등록'}</span>
          </div>
          {userData?.union_id && userData?.guild_role !== 'admin' && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={handleLeaveGuild} className="btn-danger" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>길드 탈퇴</button>
            </div>
          )}
        </div>

        <AvatarSettings />

        <div className="lobby-card" style={{ marginBottom: '2.5rem', backgroundColor: 'var(--surface-2)', border: 'none', padding: '2rem' }}>
          <h3 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.8rem', marginBottom: '1.5rem' }}>인게임 닉네임 변경</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            변경 시, <strong>길드 완장에게 승인</strong>을 받아야 하며, 길드 완장이 승인 한 이후 길드 내에서 닉네임이 변경됩니다.
          </p>
          <form onSubmit={handleNicknameChange} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-faint)' }}>새로운 닉네임 입력</label>
              <input
                type="text"
                value={newNickname}
                onChange={(e) => setNewNickname(e.target.value)}
                placeholder="변경할 닉네임 입력 (1~8글자)"
                maxLength={8}
                disabled={nickLoading || !userData?.union_id || !!pendingNickRequest}
                style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-2)', color: 'var(--text-strong)' }}
              />
              {!userData?.union_id && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '5px' }}>현재 소속된 길드가 없어 닉네임을 변경할 수 없습니다.</p>}
              {pendingNickRequest && (
                <div style={{ marginTop: '5px', color: 'var(--danger-strong)', fontSize: '0.85rem' }}>
                  * 현재 길드 완장의 승인을 대기 중입니다. ({pendingNickRequest.new_nickname})
                </div>
              )}
            </div>
            <button type="submit" className="primary-btn w-full" disabled={nickLoading || !!pendingNickRequest || !userData?.union_id || !newNickname.trim()} style={{ backgroundColor: 'var(--info)' }}>
              {nickLoading ? '변경 중...' : '인게임 닉네임 변경'}
            </button>
          </form>
        </div>

        <div className="lobby-card" style={{ marginBottom: '2.5rem', backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-2)', padding: '2rem' }}>
          <h3 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.8rem', marginBottom: '1.5rem' }}>알림 설정</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--surface-2)', padding: '15px', borderRadius: '8px' }}>
            <div>
              <div style={{ color: 'var(--text-strong)', fontWeight: 'bold', fontSize: '1rem' }}>멘션 알림음 재생</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>채팅에서 나를 언급할 때 짧은 신호음을 재생합니다.</div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleTestNotification}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-3)',
                  backgroundColor: 'var(--surface-1)',
                  color: 'var(--text-strong)',
                  cursor: 'pointer',
                }}
              >
                테스트
              </button>
              <button
                onClick={handleToggleSound}
                style={{
                  padding: '8px 16px',
                  borderRadius: '20px',
                  border: 'none',
                  backgroundColor: soundEnabled ? 'var(--accent-green)' : 'var(--border-2)',
                  color: soundEnabled ? 'var(--text-inverse)' : 'var(--text-strong)',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
              >
                {soundEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--surface-2)', padding: '15px', borderRadius: '8px', marginTop: '12px' }}>
            <div>
              <div style={{ color: 'var(--text-strong)', fontWeight: 'bold', fontSize: '1rem' }}>백그라운드 푸시 알림</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
                브라우저를 닫아도 이 기기로 멘션 알림을 받습니다. (기기별 설정)
              </div>
              {pushStatus === 'unsupported' && (
                <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '4px' }}>
                  이 브라우저는 푸시를 지원하지 않습니다. iPhone/iPad는 Safari에서 '홈 화면에 추가' 후 앱으로 열면 사용할 수 있습니다.
                </div>
              )}
              {pushStatus === 'denied' && (
                <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '4px' }}>
                  알림 권한이 차단되어 있습니다. 주소창의 사이트 설정에서 알림을 허용해주세요.
                </div>
              )}
            </div>
            <button
              onClick={handleTogglePush}
              disabled={pushLoading || pushStatus === 'loading' || pushStatus === 'unsupported' || pushStatus === 'denied'}
              style={{
                padding: '8px 16px',
                borderRadius: '20px',
                border: 'none',
                backgroundColor: pushStatus === 'subscribed' ? 'var(--accent-green)' : 'var(--border-2)',
                color: pushStatus === 'subscribed' ? 'var(--text-inverse)' : 'var(--text-strong)',
                fontWeight: 'bold',
                cursor: (pushStatus === 'unsupported' || pushStatus === 'denied') ? 'not-allowed' : 'pointer',
                opacity: (pushLoading || pushStatus === 'loading' || pushStatus === 'unsupported' || pushStatus === 'denied') ? 0.6 : 1,
                transition: 'background-color 0.2s',
                flexShrink: 0,
                marginLeft: '10px'
              }}
            >
              {pushLoading ? '...' : pushStatus === 'subscribed' ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <div className="lobby-card" style={{ marginBottom: '2.5rem', backgroundColor: 'var(--surface-2)', border: 'none', padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.8rem' }}>
            <h3 style={{ margin: 0, color: 'var(--text-strong)' }}>계정 비밀번호 변경</h3>
          </div>
          <form onSubmit={handlePasswordChange}>
            <div className="form-group">
              <label>새 비밀번호</label>
              <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="최소 6자 이상" />
            </div>
            <div className="form-group">
              <label>새 비밀번호 확인</label>
              <input type="password" required value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)} placeholder="비밀번호 다시 입력" />
            </div>
            <button type="submit" className="primary-btn w-full" disabled={pwLoading}>
              {pwLoading ? '변경 중...' : '비밀번호 변경'}
            </button>
          </form>
        </div>

        <div className="lobby-card" style={{ marginBottom: '2.5rem', backgroundColor: 'var(--surface-2)', border: 'none', padding: '2rem' }}>
          <h3 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.8rem', marginBottom: '1.5rem' }}>인게임 UID 변경 신청</h3>
          <p style={{ color: 'var(--error)', fontSize: '0.85rem', marginBottom: '1.5rem', backgroundColor: 'rgba(220,53,69,0.1)', padding: '0.8rem', borderRadius: '4px' }}>
            <strong>⚠️ 주의사항</strong><br />
            본인 UID가 아닌 UID를 입력하지 말아주세요. 원래 UID의 주인의 활동이 제한될 수 있습니다. 특정 길드에서 <strong>UID 긴빠이 행위가 다수 적발</strong>된다면 해당 길드가 차단될 수 있습니다.
          </p>

          <div className="form-group">
            <label>현재 등록된 UID</label>
            <input type="text" value={userData?.uid || '등록된 UID가 없습니다.'} readOnly style={{ backgroundColor: 'var(--surface-1)', color: 'var(--text-muted)', cursor: 'not-allowed', borderColor: 'var(--border-2)' }} />
          </div>

          {pendingUidRequest ? (
            <div style={{ padding: '1rem', border: '1px solid var(--accent-amber)', backgroundColor: 'rgba(255, 193, 7, 0.1)', borderRadius: '8px', color: 'var(--accent-amber)', textAlign: 'center' }}>
              현재 <strong>{pendingUidRequest.new_uid}</strong> (으)로 UID 변경 심사가 접수되어 대기 중입니다.<br />관리자의 승인을 기다려주세요.
            </div>
          ) : (
            <form onSubmit={handleUidRequest}>
              <div className="form-group">
                <label>새로운 인게임 UID</label>
                <input type="text" maxLength={8} required value={newUid} onChange={e => setNewUid(e.target.value.replace(/[^0-9]/g, ''))} placeholder="숫자 8자리" />
              </div>
              <button type="submit" className="primary-btn w-full" disabled={uidLoading} style={{ backgroundColor: '#ff9800', color: 'var(--text-strong)', border: 'none' }}>
                {uidLoading ? '신청 중...' : 'UID 변경 심사 요청하기'}
              </button>
            </form>
          )}
        </div>

        <div className="lobby-card" style={{ marginBottom: '2.5rem', backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-2)', padding: '2rem' }}>
          <h3 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '0.8rem', marginBottom: '1.5rem' }}>프로필 이미지 설정</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>채팅과 멤버 목록에 표시될 기본 프로필 이미지를 선택하세요.</p>

          {/* 기본(이니셜) 옵션 — 검색/페이지와 무관하게 항상 표시 */}
          <div
            onClick={() => handleProfileImageSelect(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: '15px',
              cursor: 'pointer', borderRadius: '8px', padding: '12px', marginBottom: '1.5rem',
              backgroundColor: selectedProfileImageId === null ? 'rgba(74, 222, 128, 0.1)' : 'var(--surface-2)',
              border: selectedProfileImageId === null ? '2px solid var(--accent-green)' : '2px solid transparent',
              opacity: profileImageLoading ? 0.5 : 1
            }}
          >
            <div style={{ width: '50px', height: '50px', flexShrink: 0, borderRadius: '50%', backgroundColor: 'var(--border-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-strong)', fontSize: '1.3rem', fontWeight: 'bold' }}>
              {userData?.in_game_name ? userData.in_game_name.charAt(0).toUpperCase() : '?'}
            </div>
            <div style={{ color: 'var(--text-strong)', fontSize: '0.9rem', fontWeight: 'bold' }}>기본 (이니셜)</div>
          </div>

          {/* 검색 */}
          <input
            type="text"
            value={profileSearch}
            onChange={e => { setProfileSearch(e.target.value); setProfilePage(1); }}
            placeholder="🔍 이름 또는 축약어로 검색"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', marginBottom: '1.5rem', borderRadius: '8px', border: '1px solid var(--border-2)', backgroundColor: 'var(--surface-2)', color: 'var(--text-strong)', outline: 'none' }}
          />

          {profileImages.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>선택 가능한 프로필 이미지가 없습니다.</div>
          ) : filteredProfileImages.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>'{profileSearch.trim()}' 검색 결과가 없습니다.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '15px' }}>
                {pagedProfileImages.map(img => (
                  <div
                    key={img.id}
                    onClick={() => handleProfileImageSelect(img.id)}
                    style={{
                      cursor: 'pointer',
                      borderRadius: '8px',
                      padding: '10px',
                      textAlign: 'center',
                      backgroundColor: selectedProfileImageId === img.id ? 'rgba(74, 222, 128, 0.1)' : 'var(--surface-2)',
                      border: selectedProfileImageId === img.id ? '2px solid var(--accent-green)' : '2px solid transparent',
                      opacity: profileImageLoading ? 0.5 : 1
                    }}
                  >
                    <img
                      src={img.image_url}
                      alt={img.name}
                      loading="lazy"
                      style={{ width: '60px', height: '60px', borderRadius: '50%', objectFit: 'cover', margin: '0 auto' }}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="%23333"/><text x="30" y="35" font-family="sans-serif" font-size="10" fill="%23888" text-anchor="middle">Error</text></svg>';
                      }}
                    />
                    <div style={{ marginTop: '10px', color: 'var(--text-strong)', fontSize: '0.8rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{img.name}</div>
                  </div>
                ))}
              </div>

              {profileTotalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '1.5rem' }}>
                  <button
                    onClick={() => setProfilePage(p => Math.max(1, p - 1))}
                    disabled={currentProfilePage <= 1}
                    className="secondary-btn"
                    style={{ padding: '6px 14px', opacity: currentProfilePage <= 1 ? 0.4 : 1, cursor: currentProfilePage <= 1 ? 'not-allowed' : 'pointer' }}
                  >
                    이전
                  </button>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', minWidth: '60px', textAlign: 'center' }}>{currentProfilePage} / {profileTotalPages}</span>
                  <button
                    onClick={() => setProfilePage(p => Math.min(profileTotalPages, p + 1))}
                    disabled={currentProfilePage >= profileTotalPages}
                    className="secondary-btn"
                    style={{ padding: '6px 14px', opacity: currentProfilePage >= profileTotalPages ? 0.4 : 1, cursor: currentProfilePage >= profileTotalPages ? 'not-allowed' : 'pointer' }}
                  >
                    다음
                  </button>
                </div>
              )}
              <div style={{ textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', marginTop: '10px' }}>
                총 {filteredProfileImages.length}개{profileSearch.trim() ? ' (검색됨)' : ''}
              </div>
            </>
          )}
        </div>

        <footer style={{ borderTop: '1px solid var(--border-color)', marginTop: '1rem', paddingTop: '1.5rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem', lineHeight: 1.7 }}>
          <button
            type="button"
            onClick={() => setIsTermsOpen(true)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--text-muted)', cursor: 'pointer', font: 'inherit', textDecoration: 'underline', marginBottom: '0.5rem' }}
          >
            이용약관
          </button>
          <p style={{ margin: 0 }}>
            길드 보스전 지휘소는 '승리의 여신: 니케'의 공식 사이트가 아니며, 시프트업 주식회사 및 레벨 인피니트와 관련이 없습니다.
          </p>
          <p style={{ margin: 0 }}>
            게임 이미지의 저작권은 시프트업 주식회사, 레벨 인피니트에 있으며, 문제가 될 경우 삭제하겠습니다.
          </p>
          <p style={{ margin: '0.5rem 0 0' }}>© {new Date().getFullYear()} {OPERATOR_NAME}. All rights reserved.</p>
        </footer>

        <ReportModal
          isOpen={isReportModalOpen}
          onClose={() => setIsReportModalOpen(false)}
          reporterId={user.id}
        />
        <TermsModal isOpen={isTermsOpen} onClose={() => setIsTermsOpen(false)} />
      </div>
    </>
  );
}
