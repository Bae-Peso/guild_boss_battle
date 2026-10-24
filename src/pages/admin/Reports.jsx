import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableTh, TableSearchInput } from '../../components/TableControls';

const REPORT_SORT_ACCESSORS = {
  type: (r) => r.type || '',
  category: (r) => r.category || '',
  reporter: (r) => r.reporter?.username || '',
  target: (r) => r.target?.username || '',
  content: (r) => r.content || '',
  created_at: (r) => r.created_at || '',
  status: (r) => r.status || '',
};

export default function Reports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchReports = async () => {
    setLoading(true);
    // reporter와 target_user의 username을 함께 가져옵니다.
    const { data, error } = await supabase
      .from('reports')
      .select(`
        *,
        reporter:users!reporter_id(username),
        target:users!target_user_id(username)
      `)
      .order('created_at', { ascending: false });
    
    if (data) setReports(data);
    else if (error) console.error("Reports fetch error:", error);
    setLoading(false);
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleStatusChange = async (id, newStatus) => {
    const { error } = await supabase.from('reports').update({ status: newStatus }).eq('id', id);
    if (!error) {
      alert('상태가 변경되었습니다.');
      fetchReports();
    } else {
      console.error(error);
      alert('오류가 발생했습니다.');
    }
  };

  const handleAdminNotes = async (id, currentNotes) => {
    const note = window.prompt("관리자 메모(처리 결과 등)를 남겨주세요:", currentNotes || "");
    if (note !== null) {
      const { error } = await supabase.from('reports').update({ admin_notes: note }).eq('id', id);
      if (!error) {
        fetchReports();
      } else {
        alert('메모 저장 중 오류가 발생했습니다.');
      }
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredReports = q
    ? reports.filter((r) =>
        [r.category, r.content, r.reporter?.username, r.target?.username]
          .some((v) => v && v.toLowerCase().includes(q))
      )
    : reports;
  const sort = useTableSort(filteredReports, { accessors: REPORT_SORT_ACCESSORS, initialField: 'created_at', initialDir: 'desc' });

  if (loading && reports.length === 0) return <div>데이터를 불러오는 중입니다...</div>;

  return (
    <div>
      <h2>신고/건의 센터</h2>
      <p>유저들이 접수한 버그 제보, 기능 건의, 불량 유저 신고 내역을 열람하고 4단계로 처리합니다.</p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '1rem 0' }}>
        <TableSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="내용/신고자/대상자/유형 검색..."
          style={{ width: '100%', maxWidth: '360px' }}
        />
      </div>

      <div className="admin-table-wrap mt-4">
      <table className="admin-table">
        <thead>
          <tr>
            <SortableTh field="type" sort={sort}>분류</SortableTh>
            <SortableTh field="category" sort={sort}>유형</SortableTh>
            <SortableTh field="reporter" sort={sort}>신고자</SortableTh>
            <SortableTh field="target" sort={sort}>대상자</SortableTh>
            <SortableTh field="content" sort={sort} style={{ width: '30%' }}>내용</SortableTh>
            <SortableTh field="created_at" sort={sort}>접수일</SortableTh>
            <SortableTh field="status" sort={sort}>상태</SortableTh>
            <th>관리자 메모 / 상태 변경</th>
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((r) => (
            <tr key={r.id}>
              <td>
                <span className={`status-badge ${r.type === 'report' ? 'status-banned' : 'status-approved'}`}>
                  {r.type === 'report' ? '신고' : '건의'}
                </span>
              </td>
              <td>{r.category}</td>
              <td>{r.reporter?.username}</td>
              <td>{r.target?.username || '-'}</td>
              <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9rem' }}>{r.content}</td>
              <td style={{ fontSize: '0.85rem' }}>{new Date(r.created_at).toLocaleString()}</td>
              <td>
                <span className="status-badge" style={{
                  backgroundColor: r.status === 'pending' ? 'var(--accent-amber)' : 
                                   r.status === 'approved' ? 'var(--info)' :
                                   r.status === 'completed' ? 'var(--success)' : '#6c757d',
                  color: r.status === 'pending' ? 'var(--text-inverse)' : 'var(--text-strong)'
                }}>
                  {r.status === 'pending' ? '접수대기' :
                   r.status === 'approved' ? '확인/처리중' :
                   r.status === 'completed' ? '완료됨' : '반려됨'}
                </span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '5px', flexWrap: 'wrap' }}>
                  <button onClick={() => handleStatusChange(r.id, 'pending')} className="secondary-btn" style={{ fontSize: '0.8rem', padding: '3px 6px' }}>대기</button>
                  <button onClick={() => handleStatusChange(r.id, 'approved')} className="btn-success" style={{ backgroundColor: 'var(--info)', fontSize: '0.8rem', padding: '3px 6px' }}>진행</button>
                  <button onClick={() => handleStatusChange(r.id, 'completed')} className="btn-success" style={{ fontSize: '0.8rem', padding: '3px 6px' }}>완료</button>
                  <button onClick={() => handleStatusChange(r.id, 'rejected')} className="btn-danger" style={{ backgroundColor: '#6c757d', fontSize: '0.8rem', padding: '3px 6px' }}>반려</button>
                </div>
                <button onClick={() => handleAdminNotes(r.id, r.admin_notes)} className="secondary-btn w-full" style={{ fontSize: '0.8rem', padding: '4px' }}>
                  {r.admin_notes ? '메모 수정' : '메모 남기기'}
                </button>
                {r.admin_notes && (
                  <div style={{ marginTop: '5px', fontSize: '0.8rem', color: 'var(--text-muted)', backgroundColor: 'var(--border-color)', padding: '4px', borderRadius: '4px' }}>
                    📝 {r.admin_notes}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {sort.sorted.length === 0 && (
            <tr><td colSpan="8" className="text-center">접수된 내역이 없습니다.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
