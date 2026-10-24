// 길드 설정 > 공지사항 관리 탭. (소속 길드원 상단 배너 공지 목록 + 새 공지/내리기)
import { useTableSort } from '../../../hooks/useTableSort';
import { SortableTh } from '../../../components/TableControls';

const guildNoticeStatus = (n) => {
  if (n.closed_at) return 'closed';
  if (n.expires_at && new Date(n.expires_at) <= new Date()) return 'expired';
  return 'active';
};
const GUILD_NOTICE_SORT_ACCESSORS = {
  created_at: (n) => n.created_at || '',
  content: (n) => n.content || '',
  expires_at: (n) => n.expires_at || '',
  status: (n) => guildNoticeStatus(n),
};

export default function NoticesTab({ loading, notices, onNewNotice, onCloseNotice }) {
  const sort = useTableSort(notices, { accessors: GUILD_NOTICE_SORT_ACCESSORS, initialField: 'created_at', initialDir: 'desc' });
  return (
    <div className="settings-panel">
      <div className="settings-panel-head">
        <div>
          <h3>길드 공지사항 관리</h3>
          <p>길드 인원에게만 표시되는 공지를 게재할 수 있습니다.</p>
        </div>
        <button className="primary-btn" onClick={onNewNotice} style={{ padding: '0.55rem 1.1rem', fontSize: '0.9rem' }}>
          + 새 공지 작성
        </button>
      </div>

      <div className="settings-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh field="created_at" sort={sort}>생성 일시</SortableTh>
              <SortableTh field="content" sort={sort}>내용</SortableTh>
              <SortableTh field="expires_at" sort={sort}>공지 만료일</SortableTh>
              <SortableTh field="status" sort={sort}>상태</SortableTh>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" className="settings-empty">로딩 중...</td></tr>
            ) : sort.sorted.length === 0 ? (
              <tr><td colSpan="5" className="settings-empty">등록된 공지가 없습니다.</td></tr>
            ) : sort.sorted.map(notice => {
              const isClosed = !!notice.closed_at;
              const isExpired = !isClosed && notice.expires_at && new Date(notice.expires_at) <= new Date();
              const isActive = !isClosed && !isExpired;
              return (
                <tr key={notice.id}>
                  <td>{new Date(notice.created_at).toLocaleString()}</td>
                  {/* 긴 공지가 표 폭을 밀어내지 않도록 셀 안쪽 div 에서 말줄임 처리 */}
                  <td>
                    <div className="settings-cell-ellipsis" style={{ fontWeight: 'bold' }} title={notice.content}>
                      {notice.content}
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-soft)' }}>
                    {notice.expires_at ? new Date(notice.expires_at).toLocaleString() : '-'}
                  </td>
                  <td>
                    {isActive && <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>게시 중</span>}
                    {isClosed && <span style={{ color: 'var(--text-muted)' }}>내려감 ({new Date(notice.closed_at).toLocaleString()})</span>}
                    {isExpired && <span style={{ color: 'var(--text-muted)' }}>기간 만료</span>}
                  </td>
                  <td>
                    {isActive && (
                      <button onClick={() => onCloseNotice(notice.id)} className="secondary-btn">
                        공지 내리기
                      </button>
                    )}
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
