// 길드 설정 > 닉네임 변경 대기자 탭. (기존 멤버의 인게임 닉네임 변경 요청 승인/거절)
import { useTableSort } from '../../../hooks/useTableSort';
import { SortableTh } from '../../../components/TableControls';

const nickUser = (r) => (Array.isArray(r.users) ? r.users[0] : r.users);
const NICKNAME_SORT_ACCESSORS = {
  uid: (r) => nickUser(r)?.uid || '',
  old_nickname: (r) => r.old_nickname || '',
  new_nickname: (r) => r.new_nickname || '',
  created_at: (r) => r.created_at || '',
};

export default function NicknameRequestsTab({ loading, nicknameRequests, onResolve }) {
  const sort = useTableSort(nicknameRequests, { accessors: NICKNAME_SORT_ACCESSORS, initialField: 'created_at', initialDir: 'desc' });
  return (
    <div className="settings-panel">
      <h3>닉네임 변경 신청</h3>
      <p>길드 멤버의 인게임 닉네임 변경 신청을 승인 또는 거절합니다.</p>

      <div className="settings-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh field="uid" sort={sort}>UID</SortableTh>
              <SortableTh field="old_nickname" sort={sort}>기존 닉네임</SortableTh>
              <SortableTh field="new_nickname" sort={sort}>변경할 닉네임</SortableTh>
              <SortableTh field="created_at" sort={sort}>신청일</SortableTh>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" className="settings-empty">로딩 중...</td></tr>
            ) : sort.sorted.length === 0 ? (
              <tr><td colSpan="5" className="settings-empty">대기 중인 닉네임 변경 요청이 없습니다.</td></tr>
            ) : sort.sorted.map(r => {
              const uObj = nickUser(r);
              return (
                <tr key={r.id}>
                  <td style={{ color: 'var(--accent-amber)' }}>{uObj?.uid || '-'}</td>
                  <td style={{ color: 'var(--text-strong)' }}>{r.old_nickname || '-'}</td>
                  <td style={{ fontWeight: 'bold', color: 'var(--accent-green)' }}>{r.new_nickname}</td>
                  <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
                  <td>
                    <div className="settings-row-actions">
                      <button className="primary-btn" onClick={() => onResolve(r.id, 'approved', r.user_id, r.new_nickname)} style={{ backgroundColor: 'var(--success)' }}>승인</button>
                      <button className="secondary-btn" onClick={() => onResolve(r.id, 'rejected', r.user_id, r.new_nickname)}>거절</button>
                    </div>
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
