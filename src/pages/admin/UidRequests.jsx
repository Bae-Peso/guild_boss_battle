import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { logAudit } from '../../lib/auditLogger';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableTh, TableSearchInput } from '../../components/TableControls';

// r.users는 조인 결과라 배열/객체 어느 쪽이든 올 수 있다.
const uidUser = (r) => (Array.isArray(r.users) ? r.users[0] : r.users);

const UID_SORT_ACCESSORS = {
  username: (r) => uidUser(r)?.username || '',
  old_uid: (r) => r.old_uid || '',
  new_uid: (r) => r.new_uid || '',
  created_at: (r) => r.created_at || '',
};

export default function UidRequests() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchRequests = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('uid_change_requests')
      .select('*, users(username, uid)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
      
    if (error) console.error("Error fetching UID requests:", error);
    if (data) setRequests(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const handleApprove = async (request) => {
    if (!window.confirm(`[${request.users?.username}] 님의 UID를 ${request.new_uid}(으)로 변경 승인하시겠습니까?`)) return;

    // 1. users 테이블 업데이트
    const { error: userError } = await supabase
      .from('users')
      .update({ uid: request.new_uid })
      .eq('id', request.user_id);

    if (userError) {
      alert("유저 정보 업데이트 실패: " + userError.message);
      return;
    }

    // 2. 상태 업데이트
    await supabase
      .from('uid_change_requests')
      .update({ status: 'approved', resolved_at: new Date() })
      .eq('id', request.id);

    await logAudit(null, user.id, 'uid_approved', `[${request.users?.username}] 유저의 UID 변경 신청 승인됨.`);
    alert("승인되었습니다.");
    fetchRequests();
  };

  const handleReject = async (request) => {
    if (!window.confirm("정말 이 UID 변경 신청을 거절하시겠습니까?")) return;

    await supabase
      .from('uid_change_requests')
      .update({ status: 'rejected', resolved_at: new Date() })
      .eq('id', request.id);

    await logAudit(null, user.id, 'uid_rejected', `[${request.users?.username}] 유저의 UID 변경 신청 반려됨.`);
    alert("거절되었습니다.");
    fetchRequests();
  };

  const handleBan = async (request) => {
    if (!window.confirm(`정말 [${request.users?.username}] 유저를 영구 차단하시겠습니까?\n사유: 허위 UID 변경 신청`)) return;

    // 1. 유저 글로벌 밴 처리
    const { error: banError } = await supabase
      .from('users')
      .update({ global_ban_reason: '허위 UID 변경 신청' })
      .eq('id', request.user_id);

    if (banError) {
      alert("밴 처리 실패: " + banError.message);
      return;
    }

    // 2. 상태 업데이트
    await supabase
      .from('uid_change_requests')
      .update({ status: 'banned', resolved_at: new Date() })
      .eq('id', request.id);

    await logAudit(null, user.id, 'user_banned', `[${request.users?.username}] 허위 UID 변경 신청으로 영구 차단됨.`);
    alert("해당 유저가 사이트 전체에서 영구 차단 처리되었습니다.");
    fetchRequests();
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredRequests = q
    ? requests.filter((r) =>
        [uidUser(r)?.username, r.old_uid, r.new_uid].some((v) => v && String(v).toLowerCase().includes(q))
      )
    : requests;
  const sort = useTableSort(filteredRequests, { accessors: UID_SORT_ACCESSORS, initialField: 'created_at', initialDir: 'desc' });

  return (
    <div>
      <h2 style={{ color: 'var(--text-strong)', borderBottom: '1px solid var(--border-2)', paddingBottom: '1rem', marginBottom: '2rem' }}>
        UID 변경 신청 관리
      </h2>

      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        유저들이 신청한 인게임 UID 변경 내역을 심사합니다.<br/>
        장난식이나 허위로 다른 사람의 UID를 신청한 악성 유저가 있다면 <strong>[이놈 하기(차단)]</strong>를 눌러 사이트에서 영구 추방시킬 수 있습니다.
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <TableSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="계정명/UID 검색..."
          style={{ width: '100%', maxWidth: '320px' }}
        />
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh field="username" sort={sort}>가입 계정명</SortableTh>
              <SortableTh field="old_uid" sort={sort}>기존 UID</SortableTh>
              <SortableTh field="new_uid" sort={sort}>변경 희망 UID</SortableTh>
              <SortableTh field="created_at" sort={sort}>신청 일시</SortableTh>
              <th>관리 조치</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" className="text-center" style={{ padding: '2rem', color: 'var(--text-dim)' }}>로딩 중...</td></tr>
            ) : sort.sorted.length === 0 ? (
              <tr><td colSpan="5" className="text-center" style={{ padding: '2rem', color: 'var(--text-dim)' }}>현재 대기 중인 UID 변경 신청이 없습니다.</td></tr>
            ) : sort.sorted.map(r => {
              const uObj = uidUser(r);
              return (
              <tr key={r.id}>
                <td style={{ color: 'var(--text-strong)', fontWeight: 'bold' }}>{uObj?.username || '알 수 없음'}</td>
                <td style={{ color: 'var(--text-muted)' }}>{r.old_uid || '기록 없음'}</td>
                <td style={{ color: 'var(--accent-amber)', fontWeight: 'bold' }}>{r.new_uid}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => handleApprove(r)} className="primary-btn" style={{ padding: '4px 10px', fontSize: '0.85rem', backgroundColor: 'var(--success)' }}>승인</button>
                    <button onClick={() => handleReject(r)} className="secondary-btn" style={{ padding: '4px 10px', fontSize: '0.85rem' }}>거절</button>
                    <button onClick={() => handleBan(r)} className="primary-btn" style={{ padding: '4px 10px', fontSize: '0.85rem', backgroundColor: 'var(--danger-solid)' }}>이놈 하기 (차단)</button>
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  );
}
