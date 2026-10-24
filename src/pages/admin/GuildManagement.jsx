import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { logAudit } from '../../lib/auditLogger';
import { useTableSort } from '../../hooks/useTableSort';
import { SortableTh } from '../../components/TableControls';

const GUILD_SORT_ACCESSORS = {
  union_code: (u) => u.union_code || '',
  name: (u) => u.name || '',
  server_region: (u) => u.server_region || '',
  owner: (u) => u.owner?.username || '',
  status: (u) => u.status || '',
};

export default function GuildManagement() {
  const { user } = useAuth();
  const [guilds, setGuilds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchGuilds = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('unions')
      .select('*, owner:users!owner_id(username)')
      .order('union_code');
    
    if (data) setGuilds(data);
    else if (error) console.error("Guilds fetch error:", error);
    setLoading(false);
  };

  useEffect(() => {
    fetchGuilds();
  }, []);

  const handleStatusChange = async (id, newStatus, ownerId) => {
    // 승인 시: 길드장의 인게임 UID가 이미 다른 계정에서 사용 중이면 승인 불가.
    // (먼저 unions.status만 approved로 바뀌고, 멤버 승인은 users.uid UNIQUE 제약으로 트리거가 실패해
    //  롤백되면, 길드는 승인됐는데 길드장 본인은 영구 승인 대기 상태에 빠지므로 사전에 차단)
    if (newStatus === 'approved') {
      const { data: pendingAdmin } = await supabase
        .from('union_members').select('pending_uid').eq('union_id', id).eq('user_id', ownerId).maybeSingle();
      if (pendingAdmin?.pending_uid) {
        const { data: uidOwner } = await supabase
          .from('users').select('id').eq('uid', pendingAdmin.pending_uid).neq('id', ownerId).maybeSingle();
        if (uidOwner) {
          alert(`길드장의 인게임 UID(${pendingAdmin.pending_uid})가 이미 다른 계정에서 사용 중이라 승인할 수 없습니다.\n신청자에게 올바른 UID로 다시 개설 신청하도록 안내해주세요.`);
          return;
        }
      }
    }

    const { error } = await supabase.from('unions').update({ status: newStatus }).eq('id', id);
    if (!error) {
      alert(`상태가 ${newStatus}(으)로 변경되었습니다.`);
      if (newStatus === 'approved') {
         // 승인 시, 기존에 등록된 길드장의 상태를 approved로 변경
         const { data: existingAdmin } = await supabase.from('union_members').select('id, pending_uid').eq('union_id', id).eq('user_id', ownerId).maybeSingle();
         
         if (existingAdmin) {
           const { error: approveErr } = await supabase.from('union_members').update({ join_status: 'approved' }).eq('id', existingAdmin.id);
           if (approveErr) {
             // 사전 검증 이후 누군가 같은 UID를 점유한 경우(드문 경쟁 상황) — 조용히 넘기지 않고 알림
             alert(`길드장 멤버 승인 처리에 실패했습니다. 인게임 UID 중복 가능성이 있습니다.\n${approveErr.message}`);
           }

           if (existingAdmin.pending_uid) {
             const { data: uData } = await supabase.from('users').select('uid').eq('id', ownerId).single();
             if (!uData?.uid) {
               await supabase.from('users').update({ uid: existingAdmin.pending_uid }).eq('id', ownerId);
             }
           }
         } else {
           // 이전 버전 대응용 fallback (멤버 데이터 없이 길드만 생성했던 경우)
           const { error: memberError } = await supabase.from('union_members').insert({
              union_id: id,
              user_id: ownerId,
              in_game_name: '길드장(미기입)',
              role: 'admin',
              join_status: 'approved'
           });
           if(memberError && memberError.code !== '23505') console.error(memberError);
         }

         // 기본 채널 2개 생성 (일반, 공지사항)
         const { data: existingChannels } = await supabase.from('channels').select('id').eq('union_id', id).limit(1);
         if (!existingChannels || existingChannels.length === 0) {
           await supabase.from('channels').insert([
             { union_id: id, name: '일반', type: 'general', is_fixed: true },
             { union_id: id, name: '공지사항', type: 'notice', is_fixed: true }
           ]);
         }
         await logAudit(id, user.id, 'union_created', `길드 개설이 사이트 관리자에 의해 승인되었습니다.`);
      }
      fetchGuilds();
    } else {
      console.error(error);
      alert('상태 변경 오류가 발생했습니다.');
    }
  };

  const handleDelete = async (id, name) => {
    if (window.confirm(`정말 '${name}' 길드를 완전히 삭제하시겠습니까?\n관련된 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다.`)) {
      await logAudit(id, user.id, 'union_deleted', `[${name}] 길드가 사이트 관리자에 의해 영구 삭제되었습니다.`);
      const { error } = await supabase.from('unions').delete().eq('id', id);
      if (!error) {
        alert('삭제되었습니다.');
        fetchGuilds();
      } else {
        console.error(error);
        alert('삭제 중 오류가 발생했습니다.');
      }
    }
  };

  const q = searchQuery.trim().toLowerCase();
  const filteredGuilds = guilds.filter((u) => {
    if (filterStatus !== 'all' && u.status !== filterStatus) return false;
    if (q) return u.name.toLowerCase().includes(q) || u.union_code.toLowerCase().includes(q);
    return true;
  });
  const sort = useTableSort(filteredGuilds, { accessors: GUILD_SORT_ACCESSORS, initialField: 'union_code' });

  if (loading) return <div>데이터를 불러오는 중입니다...</div>;

  return (
    <div>
      <h2>길드 관리</h2>
      <p>사이트에 개설 신청된 길드를 승인하거나 차단할 수 있으며, 잘못 생성된 경우 완전히 삭제할 수 있습니다.</p>
      
      <div style={{ display: 'flex', gap: '15px', marginTop: '20px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <button onClick={() => setFilterStatus('all')} className={filterStatus === 'all' ? 'btn-primary' : 'btn-secondary'} style={{ marginRight: '5px' }}>전체</button>
          <button onClick={() => setFilterStatus('pending')} className={filterStatus === 'pending' ? 'btn-primary' : 'btn-secondary'} style={{ marginRight: '5px' }}>대기</button>
          <button onClick={() => setFilterStatus('approved')} className={filterStatus === 'approved' ? 'btn-primary' : 'btn-secondary'} style={{ marginRight: '5px' }}>승인됨</button>
          <button onClick={() => setFilterStatus('banned')} className={filterStatus === 'banned' ? 'btn-primary' : 'btn-secondary'}>차단됨</button>
        </div>
        <input 
          type="text" 
          placeholder="길드명 또는 길드 ID 검색..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--text-soft)', backgroundColor: 'var(--border-color)', color: 'var(--text-strong)', width: '300px' }}
        />
      </div>

      <div className="admin-table-wrap mt-4">
      <table className="admin-table">
        <thead>
          <tr>
            <SortableTh field="union_code" sort={sort}>코드</SortableTh>
            <SortableTh field="name" sort={sort}>길드 명</SortableTh>
            <SortableTh field="server_region" sort={sort}>서버</SortableTh>
            <SortableTh field="owner" sort={sort}>신청자(ID)</SortableTh>
            <SortableTh field="status" sort={sort}>상태</SortableTh>
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {sort.sorted.map((u) => (
            <tr key={u.id}>
              <td>{u.union_code}</td>
              <td>{u.name}</td>
              <td>{u.server_region}</td>
              <td>{u.owner?.username}</td>
              <td>
                <span className={`status-badge status-${u.status}`}>
                  {u.status === 'pending' ? '대기' : u.status === 'approved' ? '승인됨' : '차단됨'}
                </span>
              </td>
              <td>
                {u.status === 'pending' && (
                  <>
                    <button onClick={() => handleStatusChange(u.id, 'approved', u.owner_id)} className="btn-success mx-1">승인</button>
                    <button onClick={() => handleStatusChange(u.id, 'banned', u.owner_id)} className="btn-danger mx-1">거절</button>
                  </>
                )}
                {u.status === 'approved' && (
                  <button onClick={() => handleStatusChange(u.id, 'banned', u.owner_id)} className="btn-danger mx-1">차단</button>
                )}
                {u.status === 'banned' && (
                  <button onClick={() => handleStatusChange(u.id, 'approved', u.owner_id)} className="btn-success mx-1">차단 해제</button>
                )}
                <button 
                  onClick={() => handleDelete(u.id, u.name)} 
                  className="btn-danger mx-1" 
                  style={{ backgroundColor: '#8b0000' }}
                >
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {sort.sorted.length === 0 && (
            <tr><td colSpan="6" className="text-center">조회된 길드가 없습니다.</td></tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
