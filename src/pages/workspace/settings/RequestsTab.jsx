// 길드 설정 > 가입 대기자 관리 탭. (로비에서 신청한 유저 승인/거절/차단)
import { useTableSort } from '../../../hooks/useTableSort';
import { SortableTh } from '../../../components/TableControls';

const reqUser = (r) => (Array.isArray(r.users) ? r.users[0] : r.users);
const REQUEST_SORT_ACCESSORS = {
  in_game_name: (r) => r.in_game_name || '',
  uid: (r) => r.pending_uid || reqUser(r)?.uid || '',
  created_at: (r) => r.created_at || '',
};

export default function RequestsTab({ loading, requests, onRequest }) {
  const sort = useTableSort(requests, { accessors: REQUEST_SORT_ACCESSORS, initialField: 'created_at', initialDir: 'desc' });
  return (
    <div className="settings-panel">
      <h3>가입 신청 대기열</h3>
      <p>가입을 신청한 유저들의 승인 여부를 결정합니다.</p>

      <div className="settings-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh field="in_game_name" sort={sort}>인게임 닉네임</SortableTh>
              <SortableTh field="uid" sort={sort}>UID</SortableTh>
              <SortableTh field="created_at" sort={sort}>가입 신청일</SortableTh>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="4" className="settings-empty">로딩 중...</td></tr>
            ) : sort.sorted.length === 0 ? (
              <tr><td colSpan="4" className="settings-empty">대기 중인 가입 신청이 없습니다.</td></tr>
            ) : sort.sorted.map(r => {
              const uObj = reqUser(r);
              return (
                <tr key={r.id}>
                  <td style={{ fontWeight: 'bold', color: 'var(--text-strong)' }}>{r.in_game_name || '-'}</td>
                  <td style={{ color: 'var(--accent-amber)' }}>{r.pending_uid || uObj?.uid || '-'}</td>
                  <td>{r.created_at ? new Date(r.created_at).toLocaleString() : '-'}</td>
                  <td>
                    <div className="settings-row-actions">
                      <button className="primary-btn" onClick={() => onRequest(r.id, 'approved')} style={{ backgroundColor: 'var(--success)' }}>승인</button>
                      <button className="secondary-btn" onClick={() => onRequest(r.id, 'rejected')}>거절</button>
                      <button className="btn-danger" onClick={() => onRequest(r.id, 'banned')}>차단</button>
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
