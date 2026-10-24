// 길드 설정 > 멤버 목록 관리 탭. (직책 변경/위임, 추방, 차단, 신고, 가입일시 수정, 커스텀 비고)
import { useState } from 'react';
import { useTableSort } from '../../../hooks/useTableSort';
import { SortableTh, TableSearchInput } from '../../../components/TableControls';

const memberUser = (m) => (Array.isArray(m.users) ? m.users[0] : m.users);
const ROLE_RANK = { admin: 0, sub_admin: 1, member: 2 };
const MEMBER_SORT_ACCESSORS = {
  role: (m) => ROLE_RANK[m.role] ?? 99,
  in_game_name: (m) => m.in_game_name || '',
  uid: (m) => memberUser(m)?.uid || '',
  created_at: (m) => m.created_at || '',
  last_login_at: (m) => memberUser(m)?.last_login_at || '',
};

// 직책 뱃지 색. 뱃지 크기는 .status-badge 로 통일한다.
const ROLE_BADGE = {
  admin: { label: '길드장', color: 'var(--danger-solid)' },
  sub_admin: { label: '부유뇬장', color: 'var(--success)' },
  member: { label: '길드원', color: '#6c757d' },
};

// ISO → date 입력값(YYYY-MM-DD, 로컬 날짜). 가입일시는 날짜만 다룬다.
function toLocalDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function MembersTab({
  loading, members, role, currentUserId, onRoleChange, onKick, onBan, onReport,
  canManageNotes = false, noteFields = [], memberNotes = {},
  onUpdateJoinDate, onSaveNote, onAddNoteField, onDeleteNoteField,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const q = searchQuery.trim().toLowerCase();
  const filteredMembers = q
    ? members.filter((m) => {
        const u = memberUser(m);
        return [m.in_game_name, u?.uid, u?.username].some((v) => v && String(v).toLowerCase().includes(q));
      })
    : members;
  const sort = useTableSort(filteredMembers, { accessors: MEMBER_SORT_ACCESSORS });

  const noteCols = canManageNotes ? noteFields : [];
  const colCount = 5 + noteCols.length + (role === 'admin' ? 1 : 0) + 2;

  const handleAdd = () => {
    if (!newFieldLabel.trim()) return;
    onAddNoteField?.(newFieldLabel);
    setNewFieldLabel('');
  };

  return (
    <div className="settings-panel">
      <h3>소속 멤버 명단</h3>
      <p>부길드장은 멤버 강퇴만 가능하며, 직책 변경은 길드장만 가능합니다.</p>

      {canManageNotes && (
        <div className="settings-toolbar">
          <span>비고 컬럼:</span>
          {noteFields.length === 0 && <span style={{ color: 'var(--text-dim)' }}>없음</span>}
          {noteFields.map((f) => (
            <span key={f.id} className="status-badge" style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-soft)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              {f.label}
              <button onClick={() => onDeleteNoteField?.(f.id)} title="컬럼 삭제"
                style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: 0, fontSize: '0.9rem', lineHeight: 1 }}>×</button>
            </span>
          ))}
          <input value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="새 비고 컬럼명"
            style={{ width: '150px', height: '2rem', padding: '0 8px', borderRadius: '4px', border: '1px solid var(--border-2)', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', fontSize: '0.85rem' }} />
          <button className="secondary-btn" onClick={handleAdd} style={{ height: '2rem', padding: '0 12px', fontSize: '0.85rem' }}>+ 추가</button>
        </div>
      )}

      <div className="settings-toolbar end">
        <TableSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="닉네임/UID/계정명 검색..."
          className="settings-search"
        />
      </div>

      <div className="settings-table-wrap">
        <table className="admin-table" style={{ minWidth: '900px' }}>
          <thead>
            <tr>
              <SortableTh field="role" sort={sort}>직책</SortableTh>
              <SortableTh field="in_game_name" sort={sort}>인게임 닉네임</SortableTh>
              <SortableTh field="uid" sort={sort}>UID</SortableTh>
              <SortableTh field="created_at" sort={sort}>가입일시</SortableTh>
              <SortableTh field="last_login_at" sort={sort}>최근 접속일</SortableTh>
              {noteCols.map((f) => <th key={f.id}>{f.label}</th>)}
              {role === 'admin' && <th>직책 변경</th>}
              <th>강퇴/차단</th>
              <th>유저 신고</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={colCount} className="settings-empty">로딩 중...</td></tr>
            ) : sort.sorted.length === 0 ? (
              <tr><td colSpan={colCount} className="settings-empty">가입된 멤버가 없습니다.</td></tr>
            ) : sort.sorted.map(m => {
              const uObj = memberUser(m);
              const notes = memberNotes[m.id] || {};
              const badge = ROLE_BADGE[m.role];
              return (
                <tr key={m.id}>
                  <td>
                    {badge && <span className="status-badge" style={{ backgroundColor: badge.color, color: 'var(--text-strong)' }}>{badge.label}</span>}
                  </td>
                  <td style={{ fontWeight: 'bold', color: 'var(--text-strong)' }}>{m.in_game_name || '-'}</td>
                  <td>{uObj?.uid || '-'}</td>
                  <td style={{ color: 'var(--text-soft)' }}>
                    {canManageNotes ? (
                      <input type="date" value={toLocalDateInput(m.created_at)}
                        onChange={(e) => { if (e.target.value) onUpdateJoinDate?.(m, new Date(`${e.target.value}T00:00:00`).toISOString()); }} />
                    ) : (m.created_at ? new Date(m.created_at).toLocaleDateString() : '-')}
                  </td>
                  <td style={{ color: 'var(--text-soft)' }}>{uObj?.last_login_at ? new Date(uObj.last_login_at).toLocaleString() : '기록 없음'}</td>
                  {noteCols.map((f) => (
                    <td key={f.id}>
                      <input key={`${m.id}-${f.id}-${notes[f.id] || ''}`} defaultValue={notes[f.id] || ''}
                        onBlur={(e) => onSaveNote?.(m.id, f.id, e.target.value)}
                        placeholder="-"
                        className="settings-note-input" />
                    </td>
                  ))}
                  {role === 'admin' && (
                    <td>
                      {m.role !== 'admin' && (
                        <select value={m.role} onChange={(e) => onRoleChange(m, e.target.value)}>
                          <option value="member">길드원</option>
                          <option value="sub_admin">부유뇬장 임명</option>
                          <option value="transfer_admin" style={{ color: 'var(--error)' }}>👑 길드장 위임</option>
                        </select>
                      )}
                    </td>
                  )}
                  <td>
                    {m.role !== 'admin' && (
                      /* 세로로 쌓으면 이 행만 두 배로 높아져서 가로로 나란히 둔다 */
                      <div className="settings-row-actions">
                        <button
                          className="secondary-btn"
                          onClick={() => onKick(m)}
                          style={{ borderColor: 'var(--accent-amber)', color: 'var(--accent-amber)' }}
                        >
                          추방
                        </button>
                        <button className="btn-danger" onClick={() => onBan(m.id, m.in_game_name)}>
                          차단
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    {m.user_id !== currentUserId && (
                      <button
                        className="settings-icon-btn"
                        onClick={() => onReport(m.user_id, m.in_game_name || uObj?.username)}
                        title="유저 신고하기"
                      >
                        🚨
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
