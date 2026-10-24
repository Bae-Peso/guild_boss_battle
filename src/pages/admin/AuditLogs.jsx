import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableTh, TableSearchInput } from '../../components/TableControls';

const AUDIT_SORT_ACCESSORS = {
  created_at: (l) => l.created_at || '',
  guild: (l) => l.guild?.name || '',
  actor: (l) => l.actor?.username || '',
  action_type: (l) => l.action_type || '',
  description: (l) => l.description || '',
};

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('audit_logs')
      .select(`
        *,
        actor:users!actor_id(username),
        guild:unions!union_id(name)
      `)
      .order('created_at', { ascending: false })
      .limit(100);
    
    if (data) setLogs(data);
    else if (error) console.error(error);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const q = searchQuery.trim().toLowerCase();
  const filteredLogs = q
    ? logs.filter((l) =>
        [l.guild?.name, l.actor?.username, l.action_type, l.description]
          .some((v) => v && String(v).toLowerCase().includes(q))
      )
    : logs;
  const sort = useTableSort(filteredLogs, { accessors: AUDIT_SORT_ACCESSORS, initialField: 'created_at', initialDir: 'desc' });

  return (
    <div>
      <h2>사이트 전체 활동 로그 (Audit Logs)</h2>
      <p>모든 길드에서 발생하는 가입, 탈퇴, 강퇴, 권한 변경 등의 중요 액션을 실시간 감시합니다. (최근 100건)</p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '1rem 0' }}>
        <TableSearchInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="길드/행위자/유형/내용 검색..."
          style={{ width: '100%', maxWidth: '360px' }}
        />
      </div>

      <div className="admin-table-wrap mt-4">
      <table className="admin-table">
        <thead>
          <tr>
            <SortableTh field="created_at" sort={sort} style={{ width: '15%' }}>시간</SortableTh>
            <SortableTh field="guild" sort={sort} style={{ width: '20%' }}>길드 명</SortableTh>
            <SortableTh field="actor" sort={sort} style={{ width: '15%' }}>행위자 (Actor)</SortableTh>
            <SortableTh field="action_type" sort={sort} style={{ width: '15%' }}>유형 (Action)</SortableTh>
            <SortableTh field="description" sort={sort} style={{ width: '35%' }}>상세 내용</SortableTh>
          </tr>
        </thead>
        <tbody>
          {loading && logs.length === 0 ? (
            <tr><td colSpan="5" className="text-center">로그를 수집하는 중입니다...</td></tr>
          ) : sort.sorted.length === 0 ? (
            <tr><td colSpan="5" className="text-center">기록된 활동 로그가 없습니다.</td></tr>
          ) : (
            sort.sorted.map(log => (
              <tr key={log.id}>
                <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{new Date(log.created_at).toLocaleString()}</td>
                <td style={{ fontWeight: 'bold' }}>{log.guild?.name || '알 수 없음'}</td>
                <td>{log.actor?.username || '시스템'}</td>
                <td>
                  <span className="status-badge" style={{ backgroundColor: 'var(--info)', color: 'var(--text-strong)', fontSize: '0.75rem' }}>
                    {log.action_type.toUpperCase()}
                  </span>
                </td>
                <td style={{ fontSize: '0.9rem' }}>{log.description}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
