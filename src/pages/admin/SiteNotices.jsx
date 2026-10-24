import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableTh, TableSearchInput } from '../../components/TableControls';

const noticeStatusValue = (n) => {
  if (n.closed_at) return 'closed';
  if (n.expires_at && new Date(n.expires_at) <= new Date()) return 'expired';
  return 'active';
};

const NOTICE_SORT_ACCESSORS = {
  created_at: (n) => n.created_at || '',
  content: (n) => n.content || '',
  expires_at: (n) => n.expires_at || '',
  status: (n) => noticeStatusValue(n),
};

export default function SiteNotices() {
  const { user } = useAuth();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [content, setContent] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  const fetchNotices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('site_notices')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error('site_notices fetch error:', error);
    if (data) setNotices(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchNotices();
  }, []);

  const openModal = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const pad = (n) => String(n).padStart(2, '0');
    setExpiresAt(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    setContent('');
    setIsModalOpen(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!content.trim()) return;
    if (!expiresAt) {
      alert('공지를 자동으로 내릴 일시를 입력해주세요.');
      return;
    }
    const expiresIso = new Date(expiresAt).toISOString();
    if (new Date(expiresIso) <= new Date()) {
      alert('공지를 내릴 일시는 현재 시각보다 이후여야 합니다.');
      return;
    }
    const { error } = await supabase.from('site_notices').insert({
      content: content.trim(),
      created_by: user.id,
      expires_at: expiresIso,
    });
    if (error) {
      alert('공지 작성 중 오류가 발생했습니다: ' + error.message);
      return;
    }
    setIsModalOpen(false);
    fetchNotices();
  };

  const handleClose = async (id) => {
    if (!window.confirm('이 공지를 내리시겠습니까?\n내린 공지는 이후 어떤 유저에게도 표시되지 않습니다.')) return;
    const { error } = await supabase
      .from('site_notices')
      .update({ closed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      alert('공지 내리기 중 오류가 발생했습니다: ' + error.message);
      return;
    }
    fetchNotices();
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredNotices = q
    ? notices.filter((n) => n.content && n.content.toLowerCase().includes(q))
    : notices;
  const sort = useTableSort(filteredNotices, { accessors: NOTICE_SORT_ACCESSORS, initialField: 'created_at', initialDir: 'desc' });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2>사이트 전체 공지 관리</h2>
          <p>모든 유저의 화면 상단에 노출되는 사이트 전역 공지를 관리합니다. 설정한 일시가 지나거나 직접 내리면 이후 접속하는 유저에게는 더 이상 표시되지 않습니다.</p>
        </div>
        <button className="primary-btn" onClick={openModal} style={{ whiteSpace: 'nowrap' }}>+ 새 공지 작성</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '1rem 0' }}>
        <TableSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="공지 내용 검색..."
          style={{ width: '100%', maxWidth: '320px' }}
        />
      </div>

      <div className="admin-table-wrap mt-4">
      <table className="admin-table" style={{ width: '100%' }}>
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
            <tr><td colSpan="5" className="text-center" style={{ padding: '2rem', color: 'var(--text-dim)' }}>로딩 중...</td></tr>
          ) : sort.sorted.length === 0 ? (
            <tr><td colSpan="5" className="text-center" style={{ padding: '2rem', color: 'var(--text-dim)' }}>등록된 공지가 없습니다.</td></tr>
          ) : sort.sorted.map(notice => {
            const isClosed = !!notice.closed_at;
            const isExpired = !isClosed && notice.expires_at && new Date(notice.expires_at) <= new Date();
            const isActive = !isClosed && !isExpired;
            return (
              <tr key={notice.id}>
                <td>{new Date(notice.created_at).toLocaleString()}</td>
                <td style={{ maxWidth: '350px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 'bold' }}>{notice.content}</td>
                <td style={{ fontSize: '0.9rem' }}>{notice.expires_at ? new Date(notice.expires_at).toLocaleString() : '-'}</td>
                <td>
                  {isActive && <span style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>게시 중</span>}
                  {isClosed && <span style={{ color: 'var(--text-muted)' }}>내려감 ({new Date(notice.closed_at).toLocaleString()})</span>}
                  {isExpired && <span style={{ color: 'var(--text-muted)' }}>기간 만료</span>}
                </td>
                <td>
                  {isActive && (
                    <button onClick={() => handleClose(notice.id)} className="secondary-btn" style={{ padding: '4px 8px', fontSize: '0.85rem' }}>공지 내리기</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      {isModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ backgroundColor: '#222', padding: '24px', borderRadius: '12px', width: '500px', maxWidth: '90%', border: '1px solid var(--border-color)' }}>
            <h3 style={{ margin: '0 0 15px 0' }}>새 사이트 공지 작성</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>공지 내용 (한 줄 권장)</label>
                <input
                  type="text"
                  value={content}
                  onChange={e => setContent(e.target.value)}
                  placeholder="예: 6월 30일 02시~04시 서버 점검이 예정되어 있습니다."
                  required
                />
              </div>
              <div className="form-group">
                <label>공지 내리는 일시 (이 시각이 지나면 자동으로 내려갑니다)</label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="secondary-btn" onClick={() => setIsModalOpen(false)}>취소</button>
                <button type="submit" className="primary-btn">작성하기</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
