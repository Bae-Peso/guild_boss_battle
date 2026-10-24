import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableTh } from '../../components/TableControls';

// 현재 '승인된(approved)' 소속을 우선, 없으면 신청 중(pending)을 반환.
// 차단/거절 이력은 소속으로 취급하지 않는다.
const getActiveMembership = (u) => {
  const memberships = u.union_members || [];
  return (
    memberships.find((m) => m.unions && m.join_status === 'approved') ||
    memberships.find((m) => m.unions && m.join_status === 'pending') ||
    null
  );
};

// 정렬용 값 접근자(조인/파생 컬럼 포함).
const USER_SORT_ACCESSORS = {
  username: (u) => u.username || '',
  inGameName: (u) => getActiveMembership(u)?.in_game_name || '',
  server_region: (u) => u.server_region || '',
  uid: (u) => u.uid || getActiveMembership(u)?.pending_uid || '',
  guildName: (u) => getActiveMembership(u)?.unions?.name || '',
  guildCode: (u) => getActiveMembership(u)?.unions?.union_code || '',
  created_at: (u) => u.created_at || '',
  last_login_at: (u) => u.last_login_at || '',
  status: (u) => (u.global_ban_reason ? 1 : 0),
  ban_reason: (u) => u.global_ban_reason || '',
};

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [fetchError, setFetchError] = useState(null);

  const fetchUsers = async () => {
    setLoading(true);
    // Fetch users and their guild membership
    let query = supabase
      .from('users')
      .select(`
        *,
        union_members(
          in_game_name,
          pending_uid,
          union_id,
          join_status,
          unions(name, union_code)
        )
      `)
      .order('created_at', { ascending: false });
      
    if (searchTerm) {
      // .or() 는 문자열 필터라 쉼표·괄호가 들어가면 조건이 깨진다. 검색어에서 필터 문법 문자를 뺀다.
      const term = searchTerm.replace(/[,()"\\%*:]/g, '');
      query = query.or(`username.ilike.%${term}%,uid.ilike.%${term}%`);
    }
    const { data, error } = await query;
    if (error) {
      console.error(error);
      setFetchError(error.message || JSON.stringify(error));
    }
    if (data) setUsers(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
  }, [searchTerm]);

  const sort = useTableSort(users, { accessors: USER_SORT_ACCESSORS });

  const handleBan = async (id, currentReason) => {
    const reason = window.prompt("차단 사유를 입력하세요 (사유를 모두 지우고 확인을 누르면 차단이 해제됩니다):", currentReason || "");
    if (reason !== null) {
      const val = reason.trim() === "" ? null : reason;
      const { error } = await supabase.rpc('update_user_ban_status', { p_target_user_id: id, p_reason: val });
      if (!error) {
        alert(val ? '해당 유저가 사이트 전역에서 차단되었습니다.' : '차단이 해제되었습니다.');
        fetchUsers();
      } else {
        console.error(error);
        alert('처리 중 오류가 발생했습니다: ' + error.message);
      }
    }
  };

  const handleDelete = async (id, username) => {
    if (window.confirm(`[경고] 정말로 유저 '${username}'을(를) 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 가입된 길드 정보 등 모든 데이터가 함께 영구 삭제됩니다.`)) {
      // call RPC to delete user from auth.users
      const { error } = await supabase.rpc('delete_user_by_admin', { target_user_id: id });
      if (!error) {
        alert('유저가 성공적으로 완전히 삭제되었습니다.');
        fetchUsers();
      } else {
        console.error(error);
        alert('삭제 중 오류가 발생했습니다. 권한 문제일 수 있습니다.');
      }
    }
  };

  return (
    <div>
      <h2>유저 관리</h2>
      <p>사이트에 가입된 모든 유저를 열람하고, 악성 유저를 차단(Ban)하거나 계정을 강제로 삭제할 수 있습니다.</p>
      
      <div className="mt-4 mb-4">
        <input 
          type="text" 
          placeholder="닉네임 또는 인게임 UID로 검색..." 
          value={searchTerm} 
          onChange={e => setSearchTerm(e.target.value)}
          style={{ width: '100%', maxWidth: '400px', padding: '8px', boxSizing: 'border-box' }}
        />
      </div>

      <div className="admin-table-wrap" style={{ paddingBottom: '1rem' }}>
        <table className="admin-table mt-4" style={{ minWidth: '1200px' }}>
          <thead>
            <tr>
              <SortableTh field="username" sort={sort}>사이트 ID(계정명)</SortableTh>
              <SortableTh field="inGameName" sort={sort}>인게임 닉네임</SortableTh>
              <SortableTh field="server_region" sort={sort}>서버</SortableTh>
              <SortableTh field="uid" sort={sort}>(게임)UID</SortableTh>
              <SortableTh field="guildName" sort={sort}>소속 길드</SortableTh>
              <SortableTh field="guildCode" sort={sort}>소속 길드 코드</SortableTh>
              <SortableTh field="created_at" sort={sort}>가입 일시</SortableTh>
              <SortableTh field="last_login_at" sort={sort}>마지막 로그인</SortableTh>
              <SortableTh field="status" sort={sort}>상태</SortableTh>
              <SortableTh field="ban_reason" sort={sort}>차단 사유</SortableTh>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {fetchError ? (
              <tr><td colSpan="11" className="text-center" style={{ padding: '2rem', color: 'var(--error)' }}>오류 발생: {fetchError}</td></tr>
            ) : loading ? (
              <tr><td colSpan="11" className="text-center">불러오는 중...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan="11" className="text-center" style={{ padding: '2rem' }}>조건에 맞는 유저가 없습니다.</td></tr>
            ) : (
              sort.sorted.map(u => {
                const activeMembership = getActiveMembership(u);
                const guildName = activeMembership ? activeMembership.unions.name : '-';
                const guildCode = activeMembership ? activeMembership.unions.union_code : '-';
                const inGameName = activeMembership ? activeMembership.in_game_name : '-';
                const pendingUid = activeMembership ? activeMembership.pending_uid : null;
                const displayUid = u.uid || pendingUid || '-';

                return (
                  <tr key={u.id} style={{ backgroundColor: u.global_ban_reason ? 'rgba(220, 53, 69, 0.1)' : 'transparent' }}>
                    <td style={{ fontWeight: 'bold' }}>{u.username}</td>
                    <td style={{ color: inGameName !== '-' ? 'var(--text-strong)' : 'var(--text-dim)' }}>{inGameName}</td>
                    <td>{u.server_region || '-'}</td>
                    <td>{displayUid}</td>
                    <td>{guildName}</td>
                    <td style={{ fontSize: '0.9rem', color: 'var(--text-dim)', fontWeight: 'bold' }}>
                      {guildCode !== '-' ? `# ${guildCode}` : '-'}
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{new Date(u.created_at).toLocaleString()}</td>
                    <td style={{ fontSize: '0.85rem' }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '-'}</td>
                    <td>
                      {u.global_ban_reason ? (
                        <span className="status-badge" style={{ backgroundColor: 'var(--danger-solid)', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>차단됨</span>
                      ) : (
                        <span className="status-badge" style={{ backgroundColor: 'var(--success)', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>정상</span>
                      )}
                    </td>
                    <td style={{ color: 'var(--error)' }}>{u.global_ban_reason || '-'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexDirection: 'column' }}>
                        <button 
                          onClick={() => handleBan(u.id, u.global_ban_reason)} 
                          className={u.global_ban_reason ? "secondary-btn" : "btn-danger"}
                          style={{ fontSize: '0.75rem', padding: '4px', whiteSpace: 'nowrap' }}
                        >
                          {u.global_ban_reason ? '차단 해제' : '차단(Ban)'}
                        </button>
                        <button 
                          onClick={() => handleDelete(u.id, u.username)} 
                          className="btn-danger"
                          style={{ fontSize: '0.75rem', padding: '4px', whiteSpace: 'nowrap', backgroundColor: '#8b0000' }}
                        >
                          영구 삭제
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
