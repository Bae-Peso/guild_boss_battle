// 길드 설정 > 채널 추가/삭제 탭.
import { useTableSort } from '../../../hooks/useTableSort';
import { SortableTh } from '../../../components/TableControls';

const CHANNEL_SORT_ACCESSORS = {
  name: (ch) => ch.name || '',
  type: (ch) => ch.type || '',
};

export default function ChannelsTab({ loading, channels, name, onNameChange, type, onTypeChange, onCreate, onDelete }) {
  const sort = useTableSort(channels, { accessors: CHANNEL_SORT_ACCESSORS });
  return (
    <div className="settings-panel">
      <h3>채널 생성 및 관리</h3>
      <p>새로운 텍스트 채널을 만들거나 관리합니다.</p>

      <form onSubmit={onCreate} className="settings-form-row">
        <div className="form-group" style={{ flexGrow: 2 }}>
          <label>새 채널 이름</label>
          <input type="text" value={name} onChange={onNameChange} required placeholder="예: 보스전-잡담" />
        </div>
        <div className="form-group">
          <label>채널 권한 유형</label>
          <select value={type} onChange={onTypeChange}>
            <option value="general">일반 (모두 쓰기 가능)</option>
            <option value="notice">공지사항 (관리자만 쓰기 가능)</option>
            <option value="admin_only">관리자 전용 (길드원에게는 표시되지 않음)</option>
          </select>
        </div>
        <button type="submit" className="primary-btn">추가</button>
      </form>

      <div className="settings-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh field="name" sort={sort}>채널 이름</SortableTh>
              <SortableTh field="type" sort={sort}>유형</SortableTh>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="3" className="settings-empty">로딩 중...</td></tr>
            ) : sort.sorted.length === 0 ? (
              <tr><td colSpan="3" className="settings-empty">생성된 채널이 없습니다.</td></tr>
            ) : sort.sorted.map(ch => (
              <tr key={ch.id}>
                <td style={{ color: 'var(--text-strong)', fontWeight: 'bold' }}># {ch.name}</td>
                <td style={{ color: 'var(--text-muted)' }}>
                  {ch.type === 'general' ? '일반 채팅' :
                    ch.type === 'notice' ? '📢 공지사항' :
                      ch.type === 'admin_only' ? '관리자 전용' : ''}
                </td>
                <td>
                  {ch.is_fixed ? (
                    <span style={{ color: 'var(--text-dim)' }}>기본 채널 (삭제 불가)</span>
                  ) : (
                    <button onClick={() => onDelete(ch.id)} className="btn-danger">삭제</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
