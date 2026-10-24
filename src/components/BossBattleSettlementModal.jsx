import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useEscapeKey } from '../hooks/useEscapeKey';

export default function BossBattleSettlementModal({ isOpen, onClose, guildId, seasonName, statusIds, members }) {
  useEscapeKey(isOpen, onClose);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !guildId || statusIds.length === 0) return;

    let isMounted = true;
    const fetchSettlement = async () => {
      setLoading(true);
      try {
        const { data: bData, error } = await supabase
          .from('mock_battles')
          .select('user_id, is_admin_written, manual_nickname, real_damage')
          .eq('union_id', guildId)
          .eq('status', 'completed')
          .in('boss_status_id', statusIds);

        if (error) throw error;

        // Group by user
        const userMap = {};

        // Initialize with all members so even 0 damage users appear
        members.forEach(m => {
          if (m.role !== 'admin') {
            // Wait, admin is guild owner, they also hit. We want to include everyone.
            const name = m.in_game_name || m.users?.username || '알 수 없음';
            userMap[`user_${m.user_id}`] = {
              name,
              totalDamage: 0,
              hits: 0
            };
          }
        });

        // Add hits
        if (bData) {
          bData.forEach(b => {
            const dmg = b.real_damage || 0;
            if (b.is_admin_written) {
              const name = b.manual_nickname;
              const key = `manual_${name}`;
              if (!userMap[key]) {
                userMap[key] = { name: `${name} (수기)`, totalDamage: 0, hits: 0 };
              }
              userMap[key].totalDamage += dmg;
              userMap[key].hits += 1;
            } else {
              const key = `user_${b.user_id}`;
              if (!userMap[key]) {
                userMap[key] = { name: '알 수 없음', totalDamage: 0, hits: 0 };
              }
              userMap[key].totalDamage += dmg;
              userMap[key].hits += 1;
            }
          });
        }

        const sorted = Object.values(userMap).sort((a, b) => b.totalDamage - a.totalDamage);
        
        if (isMounted) setData(sorted);
      } catch (err) {
        console.error("Failed to fetch settlement:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchSettlement();

    // 실시간 반영을 위한 Subscription
    const channel = supabase.channel(`settlement_${guildId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mock_battles',
        filter: `union_id=eq.${guildId}`
      }, (payload) => {
        // We just refetch to keep it simple and accurate
        fetchSettlement();
      })
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [isOpen, guildId, statusIds, members]);

  if (!isOpen) return null;

  return (
    <div 
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--surface-2)', padding: '30px', borderRadius: '12px', width: '90%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-2)', paddingBottom: '10px' }}>
          <h2 style={{ margin: 0, color: 'var(--text-strong)' }}>[{seasonName}] 보스전 종합 결산</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}>&times;</button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>데이터를 집계 중입니다...</div>
        ) : (
          <table className="admin-table" style={{ backgroundColor: 'var(--surface-1)' }}>
            <thead>
              <tr>
                <th>순위</th>
                <th>인게임 닉네임</th>
                <th>총 참여 타수</th>
                <th>누적 총 대미지</th>
                <th>1타당 평균 대미지</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, index) => (
                <tr key={index}>
                  <td style={{ fontWeight: 'bold', color: index < 3 ? 'var(--accent-amber)' : 'var(--text-strong)' }}>{index + 1}위</td>
                  <td style={{ fontWeight: 'bold' }}>{row.name}</td>
                  <td>{row.hits}타</td>
                  <td style={{ color: 'var(--accent-green)', fontWeight: 'bold' }}>{row.totalDamage.toLocaleString()}</td>
                  <td style={{ color: '#60a5fa' }}>{row.hits > 0 ? Math.floor(row.totalDamage / row.hits).toLocaleString() : 0}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan="5" className="text-center" style={{ padding: '2rem' }}>결산 데이터가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
