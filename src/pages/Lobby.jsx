import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import NoticeBanner from '../components/NoticeBanner';
import { useDemo } from '../demo/DemoContext';
import { REPORT_URL, GUILD_APPLY_URL } from '../lib/siteLinks';

export default function Lobby() {
  const { t } = useTranslation();
  const { signOut, user } = useAuth();
  const { enterDemo } = useDemo();
  const navigate = useNavigate();

  // Ban state
  const [banReason, setBanReason] = useState(null);
  const [hasExistingUid, setHasExistingUid] = useState(false);
  const [loading, setLoading] = useState(true);

  // Status states
  const [createStatus, setCreateStatus] = useState(null);
  const [joinStatus, setJoinStatus] = useState(null);

  useEffect(() => {
    const checkBanStatus = async () => {
      const { data } = await supabase.from('users').select('global_ban_reason, uid').eq('id', user.id).single();
      if (data && data.global_ban_reason) {
        setBanReason(data.global_ban_reason);
        setLoading(false);
        return;
      }

      if (data && data.uid) {
        setJoinUid(data.uid);
        setCreateUid(data.uid);
        setHasExistingUid(true);
      }

      // 길드 개설 신청 상태 확인
      const { data: uData } = await supabase.from('unions').select('status, name').eq('owner_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (uData) setCreateStatus(uData);

      // 길드 가입 신청 상태 확인
      const { data: mData } = await supabase.from('union_members').select('join_status, unions(name, owner_id)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (mData) {
        // 승인 시 즉시 워크스페이스로 이동
        if (mData.join_status === 'approved') {
          navigate('/workspace');
          return;
        }
        // 본인이 개설한 길드의 (관리자) 멤버십은 '개설 신청 내역' 배너로 이미 표시되므로
        // 가입 신청 배너는 중복 표시하지 않는다. (개설자는 union_members에도 pending으로 등록됨)
        if (mData.unions?.owner_id !== user.id) {
          setJoinStatus(mData);
        }
      }

      setLoading(false);
    };
    if (user) checkBanStatus();

    let channel;
    if (user) {
      channel = supabase.channel(`lobby_${user.id}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'union_members',
          filter: `user_id=eq.${user.id}`
        }, payload => {
          if (payload.new.join_status === 'approved') {
            navigate('/workspace');
          } else {
            setJoinStatus(prev => ({ ...prev, join_status: payload.new.join_status }));
          }
        })
        .subscribe();
    }

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, [user, navigate]);

  // Join Guild State
  const [joinCode, setJoinCode] = useState('');
  const [joinServer, setJoinServer] = useState('KR');
  const [joinName, setJoinName] = useState('');
  const [joinUid, setJoinUid] = useState('');
  const [joinPassphrase, setJoinPassphrase] = useState('');

  // Create Guild State
  const [createCode, setCreateCode] = useState('');
  const [createName, setCreateName] = useState('');
  const [createServer, setCreateServer] = useState('KR');
  const [createInGameName, setCreateInGameName] = useState('');
  const [createUid, setCreateUid] = useState('');

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{1,8}$/.test(joinCode)) {
      alert('길드 코드는 1~8자리의 숫자여야 합니다.');
      return;
    }
    if (joinUid.length !== 8) {
      alert('인게임 UID는 정확히 8자리 숫자여야 합니다.');
      return;
    }

    try {
      // 0. 인게임 UID 중복 확인 — 다른 계정이 이미 점유한 UID는 신청 불가
      //    (그대로 진행하면 승인 시점에 users.uid UNIQUE 제약으로 트리거가 실패해 영구 승인 대기 상태가 됨)
      const { data: uidTaken } = await supabase.rpc('is_uid_taken', { p_uid: joinUid });
      if (uidTaken) {
        alert('이미 다른 계정에서 사용 중인 인게임 UID입니다. 본인의 UID가 맞다면 마이페이지 -> \'버그 제보 / 기능 건의\'로 문의해주세요.');
        return;
      }

      // 1. 길드 코드 확인
      const { data: guildData, error: guildError } = await supabase
        .from('unions')
        .select('id')
        .eq('union_code', joinCode)
        .eq('server_region', joinServer)
        .eq('status', 'approved')
        .single();

      if (guildError || !guildData) {
        alert('존재하지 않거나 승인되지 않은 길드 코드입니다.');
        return;
      }

      // 1-1. 길드 암구호 확인 (설정된 길드만 일치해야 신청 가능)
      //      암구호 값 자체는 클라이언트에 노출되지 않으며, 서버에서 일치 여부만 검증한다.
      const { data: passOk, error: passErr } = await supabase.rpc('verify_union_passphrase', {
        p_union_id: guildData.id,
        p_passphrase: joinPassphrase,
      });
      if (passErr) {
        alert('암구호 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        return;
      }
      if (passOk !== true) {
        alert('길드 암구호가 일치하지 않습니다.\n이 길드는 가입 시 암구호가 필요합니다.\n길드 관리자에게 문의해주세요.');
        return;
      }

      // 2. 해당 길드에서의 기존 가입 이력 확인 (UID는 가입 승인 시 users 테이블에 최종 반영됨)
      const { data: existingMembership } = await supabase
        .from('union_members')
        .select('join_status')
        .eq('union_id', guildData.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingMembership) {
        // 차단된 유저는 해당 길드에 영구적으로 재가입할 수 없음 (다른 길드 가입은 가능)
        if (existingMembership.join_status === 'banned') {
          alert('해당 길드에서 차단되어 다시 가입 신청을 할 수 없습니다.');
          return;
        }
        if (existingMembership.join_status === 'approved') {
          alert('이미 해당 길드에 가입되어 있습니다.');
          return;
        }
        if (existingMembership.join_status === 'pending') {
          alert('이미 해당 길드에 가입 신청을 하셨습니다. 관리자의 승인을 기다려주세요.');
          return;
        }
        // 거절(rejected) 등 그 외 상태의 기록만 정리하여 재신청을 허용 (차단 기록은 위에서 차단됨)
        await supabase.from('union_members').delete().eq('union_id', guildData.id).eq('user_id', user.id);
      }

      // 3. 가입 신청 (새로 INSERT)
      const { error: memberError } = await supabase.from('union_members').insert({
        union_id: guildData.id,
        user_id: user.id,
        in_game_name: joinName,
        pending_uid: joinUid,
        join_status: 'pending'
      });

      if (memberError) {
        if (memberError.code === '23505') alert('이미 가입 신청을 하셨습니다.');
        else alert('가입 신청 중 오류가 발생했습니다: ' + memberError.message);
        return;
      }

      alert('가입 신청이 완료되었습니다. 관리자의 승인을 기다려주세요.');
      setJoinStatus({ join_status: 'pending', unions: { name: joinCode } });
    } catch (err) {
      console.error(err);
      alert('오류가 발생했습니다.');
    }
  };

  const handleCreateSubmit = async (e) => {
    e.preventDefault();
    if (!/^\d{1,8}$/.test(createCode)) {
      alert('길드 코드는 1~8자리의 숫자여야 합니다.');
      return;
    }
    if (createUid.length !== 8) {
      alert('인게임 UID는 정확히 8자리 숫자여야 합니다.');
      return;
    }

    try {
      // 0. 인게임 UID 중복 확인 — 다른 계정이 이미 점유한 UID는 신청 불가
      //    (그대로 진행하면 승인 시점에 users.uid UNIQUE 제약으로 트리거가 실패해 길드는 승인됐는데
      //     길드장 본인은 영구 승인 대기 상태에 빠짐)
      const { data: uidTaken } = await supabase.rpc('is_uid_taken', { p_uid: createUid });
      if (uidTaken) {
        alert('이미 다른 계정에서 사용 중인 인게임 UID입니다. 본인의 UID가 맞다면 마이페이지 -> \'버그 제보 / 기능 건의\'로 문의해주세요.');
        return;
      }

      // 1. (UID는 길드 승인 시 users 테이블에 최종 반영됨)

      // 2. 길드 개설 신청 (pending)
      const { data: guildData, error } = await supabase.from('unions').insert({
        union_code: createCode,
        name: createName,
        server_region: createServer,
        owner_id: user.id,
        status: 'pending'
      }).select().single();

      if (error) {
        if (error.code === '23505') alert('이미 존재하는 길드 코드입니다.');
        else alert('길드 개설 신청 중 오류가 발생했습니다.');
        return;
      }

      // 3. 개설자를 길드장으로 임시 등록 (pending)
      await supabase.from('union_members').insert({
        union_id: guildData.id,
        user_id: user.id,
        in_game_name: createInGameName,
        pending_uid: createUid,
        role: 'admin',
        join_status: 'pending'
      });

      alert('길드 개설 신청이 접수되었습니다. 사이트 관리자의 승인을 기다려주세요.');
      setCreateStatus({ status: 'pending', name: createName });
    } catch (err) {
      console.error(err);
      alert('오류가 발생했습니다.');
    }
  };

  if (loading) {
    return <div className="lobby-container app-container text-center mt-5" style={{ color: 'var(--text-muted)' }}>유저 정보를 확인 중입니다...</div>;
  }

  if (banReason) {
    return (
      <div className="lobby-container app-container">
        <header>
          <h1>사이트 이용 제한 안내</h1>
          <button onClick={signOut} className="secondary-btn">로그아웃</button>
        </header>
        <div style={{ backgroundColor: 'rgba(220, 53, 69, 0.1)', border: '2px solid var(--danger-solid)', borderRadius: '8px', padding: '3rem 2rem', textAlign: 'center', marginTop: '3rem' }}>
          <h2 style={{ color: 'var(--danger-solid)', marginBottom: '1.5rem', fontSize: '1.8rem' }}>🚫 서비스 이용이 전면 제한되었습니다.</h2>
          <p style={{ fontSize: '1.1rem', color: 'var(--text-strong)', marginBottom: '2rem' }}>아래의 사유로 사이트 이용 및 모든 길드 접근이 영구적으로 차단되었습니다.</p>
          <div style={{ backgroundColor: 'var(--bg-color)', padding: '1.5rem', borderRadius: '8px', display: 'inline-block', minWidth: '400px', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--error)', fontWeight: 'bold', fontSize: '1.2rem', display: 'block', marginBottom: '0.5rem' }}>차단 사유</span>
            <span style={{ fontSize: '1.1rem' }}>{banReason}</span>
          </div>
          <p style={{ color: 'var(--text-muted)', marginTop: '3rem', fontSize: '0.9rem' }}>문의사항이 있으시거나 억울한 제재라고 생각되시면 <a href={REPORT_URL} target="_blank">해당 게시글</a>에 이의를 제기해 주세요.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <NoticeBanner />
      <div className="lobby-container app-container">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>{t('welcome')}</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => window.location.href = '/mypage'} className="secondary-btn" style={{ backgroundColor: '#4f545c' }}>마이페이지</button>
            <button onClick={signOut} className="secondary-btn">로그아웃</button>
          </div>
        </header>

        <main className="lobby-content">
          <div
            className="lobby-card mb-4"
            style={{ border: '2px solid var(--accent-blurple)', backgroundColor: 'rgba(88, 101, 242, 0.1)', display: 'flex', flexDirection: 'column', gap: '12px' }}
          >
            <div>
              <h3 style={{ color: 'var(--accent-blurple)', margin: 0, marginBottom: '0.35rem' }}>🔍 가입 없이 둘러보기</h3>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                길드에 가입하지 않아도 채팅·지휘 현황판·모의전 등 모든 기능을 미리 체험해볼 수 있어요.
                <br />체험 모드에서 입력한 내용은 <strong>저장되지 않으며</strong>, 새로고침하면 초기화됩니다.
              </p>
            </div>
            <button
              type="button"
              onClick={enterDemo}
              className="primary-btn"
              style={{ backgroundColor: 'var(--accent-blurple)', alignSelf: 'flex-start', padding: '10px 20px' }}
            >
              체험판으로 둘러보기 →
            </button>
          </div>

          {createStatus && (
            <div className="lobby-card mb-4" style={{ border: '2px solid var(--accent-amber)', backgroundColor: 'rgba(255, 193, 7, 0.1)' }}>
              <h3 style={{ color: 'var(--accent-amber)', margin: 0, marginBottom: '0.5rem' }}>📢 길드 개설 신청 내역: {createStatus.name}</h3>
              <p style={{ margin: 0, fontSize: '1.1rem' }}>
                {createStatus.status === 'pending' ? <div>사이트 관리자의 승인을 대기 중입니다.<br /><a href={GUILD_APPLY_URL} target="_blank">해당 게시글</a>에 양식에 맞게 신청 댓글을 달아주세요.</div> :
                  createStatus.status === 'banned' ? <span style={{ color: 'var(--error)' }}>❌ 승인이 거절되었습니다.</span> : ''}
              </p>
            </div>
          )}

          {joinStatus && joinStatus.join_status !== 'approved' && (() => {
            const st = joinStatus.join_status;
            const theme = st === 'banned'
              ? { color: 'var(--error)', border: 'var(--danger-solid)', bg: 'rgba(220, 53, 69, 0.1)' }
              : st === 'rejected'
                ? { color: '#ffa94d', border: '#fd7e14', bg: 'rgba(253, 126, 20, 0.1)' }
                : { color: 'var(--info)', border: 'var(--info)', bg: 'rgba(23, 162, 184, 0.1)' };
            return (
              <div className="lobby-card mb-4" style={{ border: `2px solid ${theme.border}`, backgroundColor: theme.bg }}>
                <h3 style={{ color: theme.color, margin: 0, marginBottom: '0.5rem' }}>📢 길드 가입 신청 내역: {joinStatus.unions?.name || '알 수 없음'}</h3>
                <p style={{ margin: 0, fontSize: '1.1rem' }}>
                  {st === 'pending' && '해당 길드 관리자의 가입 승인을 대기 중입니다.'}
                  {st === 'rejected' && <span style={{ color: '#ffa94d' }}>❌ 가입 신청이 거절되었습니다. 다시 신청하거나 다른 길드에 가입할 수 있습니다.</span>}
                  {st === 'banned' && <span style={{ color: 'var(--error)' }}>🚫 해당 길드에서 차단되어 다시 가입할 수 없습니다. (다른 길드에는 가입할 수 있습니다.)</span>}
                </p>
              </div>
            );
          })()}

          {(!createStatus || createStatus.status !== 'pending') && (!joinStatus || joinStatus.join_status !== 'pending') && (
            <>
              <div className="lobby-card">
                <h3>기존 길드 가입 신청</h3>
                <p>가입한 길드의 정보를 기입하여 신청하세요.</p>
                <form onSubmit={handleJoinSubmit}>
                  <div className="form-group">
                    <label>길드 코드</label>
                    <input type="text" placeholder="최대 8자리 숫자" maxLength="8" required value={joinCode} onChange={e => setJoinCode(e.target.value.replace(/[^0-9]/g, ''))} />
                  </div>
                  <div className="form-group">
                    <label>서버</label>
                    <select value={joinServer} onChange={e => setJoinServer(e.target.value)}>
                      <option value="KR">KR (한국)</option>
                      <option value="Global">Global (글로벌)</option>
                      <option value="NA">NA (북미)</option>
                      <option value="JP">JP (일본)</option>
                      <option value="SEA">SEA (동남아)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>인게임 닉네임</label>
                    <input type="text" maxLength={8} placeholder="최대 8글자" required value={joinName} onChange={e => setJoinName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>인게임 UID {hasExistingUid && <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>(변경 불가)</span>}</label>
                    <input
                      type="text"
                      maxLength={8}
                      placeholder="숫자 8자리"
                      required
                      value={joinUid}
                      onChange={e => setJoinUid(e.target.value.replace(/[^0-9]/g, ''))}
                      readOnly={hasExistingUid}
                      style={hasExistingUid ? { backgroundColor: '#2a2b2f', color: 'var(--text-dim)', cursor: 'not-allowed', borderColor: 'var(--border-2)' } : {}}
                    />
                  </div>
                  <div className="form-group">
                    <label>길드 암구호 <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>(암구호가 설정된 길드만 입력)</span></label>
                    <input type="text" maxLength={30} placeholder="암구호가 없는 길드는 비워두세요" value={joinPassphrase} onChange={e => setJoinPassphrase(e.target.value)} autoComplete="off" />
                  </div>
                  <button type="submit" className="primary-btn w-full">가입 신청</button>
                </form>
              </div>

              <div className="lobby-card">
                <h3>신규 길드 개설</h3>
                <p>관리자에게 새로운 길드 개설을 신청합니다.</p>
                <form onSubmit={handleCreateSubmit}>
                  <div className="form-group">
                    <label>길드 ID</label>
                    <input type="text" placeholder="최대 8자리 숫자" maxLength="8" required value={createCode} onChange={e => setCreateCode(e.target.value.replace(/[^0-9]/g, ''))} />
                  </div>
                  <div className="form-group">
                    <label>길드 명</label>
                    <input type="text" maxLength={8} placeholder="최대 8글자" required value={createName} onChange={e => setCreateName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>길드장 인게임 닉네임</label>
                    <input type="text" maxLength={8} placeholder="최대 8글자" required value={createInGameName} onChange={e => setCreateInGameName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>길드장 인게임 UID {hasExistingUid && <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>(변경 불가)</span>}</label>
                    <input
                      type="text"
                      maxLength={8}
                      placeholder="숫자 8자리"
                      required
                      value={createUid}
                      onChange={e => setCreateUid(e.target.value.replace(/[^0-9]/g, ''))}
                      readOnly={hasExistingUid}
                      style={hasExistingUid ? { backgroundColor: '#2a2b2f', color: 'var(--text-dim)', cursor: 'not-allowed', borderColor: 'var(--border-2)' } : {}}
                    />
                  </div>
                  <div className="form-group">
                    <label>서버</label>
                    <select required value={createServer} onChange={e => setCreateServer(e.target.value)}>
                      <option value="KR">한국 (KR)</option>
                      <option value="JP">일본 (JP)</option>
                      <option value="Global">글로벌 (Global)</option>
                      <option value="NA">북미 (NA)</option>
                      <option value="SEA">동남아 (SEA)</option>
                    </select>
                  </div>
                  <button type="submit" className="primary-btn w-full" style={{ backgroundColor: 'var(--success)' }}>개설 신청</button>
                </form>
              </div>
            </>
          )}
        </main>
      </div>
    </>
  );
}
