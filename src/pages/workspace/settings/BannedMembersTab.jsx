// 길드 설정 > 차단 멤버 관리 탭. (차단된 유저 목록 + 차단 해제)
import { useTableSort } from '../../../hooks/useTableSort';
import { SortableTh } from '../../../components/TableControls';

const bannedUser = (m) => (Array.isArray(m.users) ? m.users[0] : m.users);
const BANNED_SORT_ACCESSORS = {
  in_game_name: (m) => m.in_game_name || '',
  username: (m) => bannedUser(m)?.username || '',
  uid: (m) => m.pending_uid || bannedUser(m)?.uid || '',
};

export default function BannedMembersTab({ bannedMembers, onUnban }) {
  const sort = useTableSort(bannedMembers, { accessors: BANNED_SORT_ACCESSORS });
  return (
    <div className="settings-panel">
      <h3>차단된 멤버 명단</h3>
      <p>차단된 유저는 해당 길드에 가입 신청을 할 수 없습니다. 차단을 해제하면 가입 신청이 가능해집니다.</p>

      <div className="settings-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh field="in_game_name" sort={sort}>인게임 닉네임</SortableTh>
              <SortableTh field="username" sort={sort}>사이트 ID(계정명)</SortableTh>
              <SortableTh field="uid" sort={sort}>UID</SortableTh>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {sort.sorted.length === 0 ? (
              <tr><td colSpan="4" className="settings-empty">차단된 멤버가 없습니다.</td></tr>
            ) : sort.sorted.map(m => {
              const uObj = bannedUser(m);
              return (
                <tr key={m.id}>
                  <td style={{ fontWeight: 'bold', color: 'var(--text-strong)' }}>{m.in_game_name || '-'}</td>
                  <td style={{ color: 'var(--text-soft)' }}>{uObj?.username || '-'}</td>
                  <td style={{ color: 'var(--accent-amber)' }}>{m.pending_uid || uObj?.uid || '-'}</td>
                  <td>
                    <button
                      className="primary-btn"
                      onClick={() => onUnban(m.id, m.in_game_name || uObj?.username)}
                      style={{ backgroundColor: 'var(--success)' }}
                    >
                      차단 해제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
