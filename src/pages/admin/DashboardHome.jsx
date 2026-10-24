import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';

export default function DashboardHome() {
  const [stats, setStats] = useState({
    total_users: 0,
    active_users: 0,
    approved_unions: 0,
    pending_unions: 0,
    banned_unions: 0,
    pending_reports: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAndSnapshotStats = async () => {
      setLoading(true);
      // RPC 호출: 데이터베이스 내부에서 오늘치 스냅샷 갱신 & 실시간 계산된 결과 반환
      const { data, error } = await supabase.rpc('update_daily_statistics');
      if (data) {
        setStats(data);
      } else if (error) {
        console.error("Failed to update and fetch statistics:", error);
      }
      setLoading(false);
    };

    fetchAndSnapshotStats();
  }, []);

  return (
    <div>
      <h1>백오피스 대시보드</h1>
      <p>사이트 전체 현황 및 일일 통계 스냅샷</p>

      {loading ? (
        <div className="mt-4" style={{ color: 'var(--text-muted)' }}>실시간 통계 데이터를 분석 및 갱신 중입니다...</div>
      ) : (
        <div className="dashboard-grid">
          {/* 1. 유저 통계 */}
          <div className="dashboard-card" style={{ borderTop: '4px solid #007bff' }}>
            <h3>전체 가입 유저</h3>
            <p className="big-number">{stats.total_users}</p>
          </div>
          <div className="dashboard-card" style={{ borderTop: '4px solid var(--info)' }}>
            <h3>활성화 유저 (소속됨)</h3>
            <p className="big-number">{stats.active_users}</p>
          </div>

          {/* 2. 길드 통계 */}
          <div className="dashboard-card" style={{ borderTop: '4px solid var(--success)' }}>
            <h3>승인된 길드</h3>
            <p className="big-number">{stats.approved_unions}</p>
            {stats.approved_unions > 0 && (
              <Link to="/admin/guilds" style={{ color: 'var(--primary-color)', fontSize: '0.9rem' }}>
                목록 보기 &rarr;
              </Link>
            )}
          </div>
          <div className="dashboard-card" style={{ borderTop: '4px solid var(--accent-amber)' }}>
            <h3>승인 대기 길드</h3>
            <p className="big-number" style={{ color: stats.pending_unions > 0 ? 'var(--accent-amber)' : '' }}>
              {stats.pending_unions}
            </p>
            {stats.pending_unions > 0 && (
              <Link to="/admin/guilds" style={{ color: 'var(--primary-color)', fontSize: '0.9rem' }}>
                승인 처리하러 가기 &rarr;
              </Link>
            )}
          </div>
          <div className="dashboard-card" style={{ borderTop: '4px solid var(--danger-solid)' }}>
            <h3>차단된 길드</h3>
            <p className="big-number">{stats.banned_unions}</p>
          </div>

          {/* 3. 기타 관리 통계 */}
          <div className="dashboard-card" style={{ borderTop: '4px solid #fd7e14' }}>
            <h3>처리 대기 건의/신고</h3>
            <p className="big-number" style={{ color: stats.pending_reports > 0 ? '#fd7e14' : '' }}>
              {stats.pending_reports}
            </p>
            {stats.pending_reports > 0 && (
              <Link to="/admin/reports" style={{ color: 'var(--primary-color)', fontSize: '0.9rem' }}>
                처리하러 가기 &rarr;
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
