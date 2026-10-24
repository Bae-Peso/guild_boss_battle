// 길드 설정 > 보스전 기록 관리 탭. (시즌별 지휘 데이터 추가/삭제/잠금)
import { useTableSort } from '../../../hooks/useTableSort';
import { SortableTh } from '../../../components/TableControls';

const BOSS_BATTLE_SEASON_SORT_ACCESSORS = {
  name: (s) => s.name || '',
  start_date: (s) => s.start_date || '',
};

export default function BossBattleRecordsTab({ loading, bossBattleSeasons, guildSeasonNames, lockedSeasons, onInit, onDelete, onToggleLock }) {
  const sort = useTableSort(bossBattleSeasons, { accessors: BOSS_BATTLE_SEASON_SORT_ACCESSORS });
  return (
    <div className="settings-panel">
      <h3>길드 보스전 기록 관리</h3>
      <p>
        서버에 등록된 보스전 시즌 목록입니다. 보스전 데이터를 추가하거나 잘못 생성된 보스전 데이터를 삭제할 수 있습니다.
      </p>

      <div className="settings-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <SortableTh field="name" sort={sort}>시즌 번호</SortableTh>
              <SortableTh field="start_date" sort={sort}>실시 기간</SortableTh>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="3" className="settings-empty">로딩 중...</td></tr>
            ) : sort.sorted.length === 0 ? (
              <tr><td colSpan="3" className="settings-empty">서버에 등록된 시즌이 없습니다.</td></tr>
            ) : sort.sorted.map(season => {
              const hasData = guildSeasonNames.has(season.name);
              return (
                <tr key={season.name}>
                  <td style={{ fontWeight: 'bold' }}>{season.name}</td>
                  <td>{new Date(season.start_date).toLocaleDateString()} ~ {new Date(season.end_date).toLocaleDateString()}</td>
                  <td>
                    {hasData ? (
                      <div className="settings-row-actions">
                        <button className="btn-danger" onClick={() => onDelete(season.name)}>
                          삭제
                        </button>
                        {lockedSeasons.has(season.name) ? (
                          <button
                            onClick={() => onToggleLock(season.name, true)}
                            style={{ backgroundColor: 'var(--border-1)', color: 'var(--text-strong)', border: '1px solid var(--border-3)' }}
                          >
                            🔒 잠금 해제
                          </button>
                        ) : (
                          <button
                            onClick={() => onToggleLock(season.name, false)}
                            style={{ backgroundColor: '#f59e0b', color: 'var(--text-inverse)', fontWeight: 'bold' }}
                          >
                            🔓 잠금
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        className="primary-btn"
                        onClick={() => onInit(season.name)}
                        style={{ backgroundColor: '#3b82f6', color: 'var(--text-strong)' }}
                      >
                        추가
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
