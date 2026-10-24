import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useDemo } from '../../demo/DemoContext';
import NikkeAvatar from '../../components/NikkeAvatar';
import BossImage from '../../components/BossImage';
import { SortableTh } from '../../components/TableControls';
import { useTableSort } from '../../hooks/useTableSort';
import { usePreferences } from '../../hooks/usePreferences';
import { useBossBattleSeasons } from '../../hooks/useBossBattleSeasons';
import { useGameData } from '../../contexts/GameDataContext';
import { isManager } from '../../lib/roles';
import { formatHp, formatHpJoEok, formatShortDateTime } from '../../lib/format';
import './Settlement.css';

const btnStyle = {
  background: 'transparent', border: '1px solid var(--border-3)', color: 'var(--text-soft)',
  padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem',
};

// 모의전 결과(타수) 표의 정렬 접근자. useTableSort는 빈 값을 항상 맨 아래로 보낸다.
const HIT_SORT_ACCESSORS = {
  seq: (h) => h.seq,
  name: (h) => h.name || '',
  synchro: (h) => (h.synchro_level ?? ''),
  damage: (h) => Number(h.real_damage || 0),
  stage: (h) => h.stage_level,
  ratio: (h) => (h.ratio ?? ''),
};

export default function SettlementBoss() {
  const { guild, role, leftCollapsed, rightCollapsed } = useOutletContext();
  const { bossNumber } = useParams();
  const bNum = Number(bossNumber);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const demo = useDemo();
  const admin = isManager(role);
  const { hpMode, setHpMode, showSquad, setShowSquad } = usePreferences();
  const { gameIcons } = useGameData();
  const elementIconUrl = (element) =>
    gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;
  const { selectedSeason } = useBossBattleSeasons(guild?.id);
  const season = searchParams.get('season') || selectedSeason;

  const [loading, setLoading] = useState(true);
  const [boss, setBoss] = useState(null);
  const [stageRows, setStageRows] = useState([]);
  const [nikkeTop, setNikkeTop] = useState([]);
  const [hits, setHits] = useState([]);
  const [isFinalized, setIsFinalized] = useState(false);
  // 타수 표 보기 모드: 'stage' = 단계별 구분(구분선 + 단계 요약), 'all' = 전체 한 목록
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('nikke_bomanda_bossHitView') || 'stage');

  const changeViewMode = (mode) => {
    setViewMode(mode);
    localStorage.setItem('nikke_bomanda_bossHitView', mode);
  };

  const fetchData = useCallback(async () => {
    if (!season || !guild?.id || !bNum || demo.isDemo) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data: statuses, error: sErr } = await supabase
        .from('union_raid_status')
        .select('id, stage_level, is_cleared, cleared_at, global_raid_bosses!inner ( boss_number, name, element, boss_grade, season_name, image_url, image_alt )')
        .eq('union_id', guild.id)
        .eq('global_raid_bosses.season_name', season)
        .eq('global_raid_bosses.boss_number', bNum)
        .order('stage_level', { ascending: true });
      if (sErr) throw sErr;

      if (!statuses || statuses.length === 0) {
        setBoss(null); setStageRows([]); setNikkeTop([]); setHits([]); setLoading(false); return;
      }
      const bossInfo = statuses[0].global_raid_bosses;
      setBoss(bossInfo);
      const statusMap = {};
      statuses.forEach(s => { statusMap[s.id] = { stage_level: s.stage_level, is_cleared: s.is_cleared, cleared_at: s.cleared_at }; });
      const statusIds = statuses.map(s => s.id);

      const [bRes, memRes, finRes, snapRes, hpRes] = await Promise.all([
        supabase.from('mock_battles').select('*').eq('union_id', guild.id).eq('status', 'completed')
          .in('boss_status_id', statusIds).order('completed_at', { ascending: true }),
        supabase.from('union_members').select('user_id, in_game_name').eq('union_id', guild.id).eq('join_status', 'approved'),
        supabase.from('union_settlement_status').select('is_finalized').eq('union_id', guild.id).eq('season_name', season).maybeSingle(),
        supabase.from('union_settlement_members').select('member_key, display_name').eq('union_id', guild.id).eq('season_name', season),
        supabase.from('raid_season_hp_settings').select('stage_level, lord_hp, tyrant_hp').eq('season_name', season),
      ]);

      const memberMap = {};
      (memRes.data || []).forEach(m => { memberMap[m.user_id] = m.in_game_name; });
      // 탈퇴 등으로 로스터에 없는 유저의 닉네임은 결산 스냅샷(display_name)에서 폴백한다.
      const nameByKey = {};
      (snapRes.data || []).forEach(r => { if (r.display_name) nameByKey[r.member_key] = r.display_name; });
      const battles = bRes.data || [];
      setIsFinalized(!!finRes.data?.is_finalized);

      // 단계별 보스 최대 체력(등급별). 5번 보스의 무한 단계는 설정에 없어 null → 삭감률 미표시.
      const maxHpByStage = {};
      (hpRes.data || []).forEach(r => {
        maxHpByStage[r.stage_level] = Number(bossInfo.boss_grade === '로드급' ? r.lord_hp : r.tyrant_hp);
      });

      // b) 단계별 소모 타수 / 평균 대미지 / 입힌 피해량
      const stageAgg = {};
      statuses.forEach(s => {
        stageAgg[s.stage_level] = {
          stage_level: s.stage_level, count: 0, sum: 0, lastHitAt: null,
          cleared_at: s.cleared_at, is_cleared: s.is_cleared,
          maxHp: maxHpByStage[s.stage_level] ?? null,
        };
      });
      battles.forEach(b => {
        const st = statusMap[b.boss_status_id];
        if (!st) return;
        const agg = stageAgg[st.stage_level];
        agg.count += 1;
        agg.sum += Number(b.real_damage || 0);
        // 무한 단계는 클리어가 없어 '마지막 타수 시각'을 클리어 시각 대신 쓴다.
        const t = b.completed_at || null;
        if (t && (agg.lastHitAt == null || t > agg.lastHitAt)) agg.lastHitAt = t;
      });
      Object.values(stageAgg).forEach(a => {
        a.cutPct = a.maxHp > 0 ? Math.min(100, (a.sum / a.maxHp) * 100) : null;
        // 체력 설정에 없는 단계 = 5번 보스의 무한 단계
        a.isInfinite = a.maxHp == null;
      });
      setStageRows(Object.values(stageAgg).sort((a, b) => a.stage_level - b.stage_level));

      // c) 자주 사용된 니케 5선
      const nikkeCount = {};
      battles.forEach(b => {
        [b.slot_1_nikke_id, b.slot_2_nikke_id, b.slot_3_nikke_id, b.slot_4_nikke_id, b.slot_5_nikke_id]
          .forEach(id => { if (id != null) nikkeCount[id] = (nikkeCount[id] || 0) + 1; });
      });
      setNikkeTop(Object.entries(nikkeCount).map(([id, count]) => ({ id: Number(id), count }))
        .sort((a, b) => b.count - a.count).slice(0, 5));

      // d) 타수별 대미지 테이블 (진입 순서 = 완료 순서)
      setHits(battles.map((b, i) => ({
        ...b,
        seq: i + 1,
        name: b.is_admin_written
          ? (b.manual_nickname || nameByKey[`manual:${b.manual_nickname}`] || '수기')
          : (memberMap[b.user_id] || nameByKey[`user:${b.user_id}`] || '알 수 없음'),
        isManual: !!b.is_admin_written,
        stage_level: statusMap[b.boss_status_id]?.stage_level,
      })));
    } catch (err) {
      console.error('보스 결산 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [season, guild?.id, bNum, demo.isDemo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 대미지 비율. 보기 모드에 따라 분모가 다르다.
  //  - 단계별: 그 단계 보스의 최대 체력 (그 타수가 피통을 몇 % 깎았는지)
  //  - 전체  : 이 보스에 길드가 가한 총 대미지 (길드 총합 중 몇 %인지)
  // 무한 단계는 최대 체력이 없어 단계별 보기에서도 그 단계 총 대미지를 분모로 쓴다.
  const totalBossDamage = useMemo(
    () => hits.reduce((sum, h) => sum + Number(h.real_damage || 0), 0),
    [hits]
  );
  const hitRows = useMemo(() => {
    const stageMap = {};
    stageRows.forEach(s => { stageMap[s.stage_level] = s; });
    return hits.map(h => {
      const st = stageMap[h.stage_level];
      const denom = viewMode === 'stage' ? (st?.maxHp || st?.sum || 0) : totalBossDamage;
      return { ...h, ratio: denom > 0 ? (Number(h.real_damage || 0) / denom) * 100 : null };
    });
  }, [hits, stageRows, viewMode, totalBossDamage]);

  const sort = useTableSort(hitRows, { accessors: HIT_SORT_ACCESSORS });

  // 단계별 보기: 정렬 결과를 단계 단위로 묶는다(단계 순서는 오름차 고정, 정렬은 단계 안에서 적용).
  const hitGroups = useMemo(() => {
    const byStage = new Map();
    sort.sorted.forEach(h => {
      const lv = h.stage_level ?? 0;
      if (!byStage.has(lv)) byStage.set(lv, []);
      byStage.get(lv).push(h);
    });
    return [...byStage.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, list]) => ({ level, list, stat: stageRows.find(s => s.stage_level === level) || null }));
  }, [sort.sorted, stageRows]);

  const goBack = () => navigate(`/workspace/settlement?season=${encodeURIComponent(season || '')}`);

  if (demo.isDemo) {
    return <div className="settlement-page"><p>체험 모드에서는 결산을 사용할 수 없습니다.</p>
      <button onClick={goBack} style={btnStyle}>돌아가기</button></div>;
  }
  if (loading) return <div className="settlement-page">데이터를 불러오는 중...</div>;
  if (!admin && !isFinalized) {
    return <div className="settlement-page">
      <p>보스전 진행 중에는 관리자만 결산을 열람할 수 있습니다.</p>
      <button onClick={goBack} style={btnStyle}>돌아가기</button>
    </div>;
  }
  if (!boss) {
    return <div className="settlement-page">
      <p>해당 보스의 결산 데이터가 없습니다.</p>
      <button onClick={goBack} style={btnStyle}>← 결산으로</button>
    </div>;
  }

  const hitColSpan = showSquad ? 6 : 5;
  const ratioTitle = viewMode === 'stage'
    ? '해당 단계 보스 체력 대비 이 타수가 가한 대미지 비율'
    : '이 보스에 길드가 가한 총 대미지 대비 이 타수의 비율';

  // 타수 한 줄. 단계별 보기에서는 단계가 구분 헤더에 있으므로 대미지 옆 단계 표기를 생략한다.
  const renderHitRow = (h) => (
    <tr key={h.id}>
      <td>{h.seq}</td>
      <td className="bd-hit-name" style={{ textAlign: 'left', fontWeight: 'bold' }}>
        {h.name}{h.isManual && <span style={{ marginLeft: 4, fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 'normal' }}>(수기)</span>}
      </td>
      <td>{h.synchro_level != null ? `Lv.${h.synchro_level}` : '-'}</td>
      {showSquad && (
        <td className="bd-hit-squad-col">
          <div className="bd-hit-squad">
            {[h.slot_1_nikke_id, h.slot_2_nikke_id, h.slot_3_nikke_id, h.slot_4_nikke_id, h.slot_5_nikke_id].map((nid, k) => (
              <NikkeAvatar key={k} nikkeId={nid} size={48} style={{ aspectRatio: '1/1' }} />
            ))}
          </div>
        </td>
      )}
      <td>
        {/* 좁은 폭에서 줄바꿈되면 '대미지' → '막타 · 단계' 순으로 접히도록 대미지를 먼저 둔다. */}
        <div className="bd-hit-dmg">
          <span className="bd-hit-dmg-val">{formatHp(h.real_damage, hpMode)}</span>
          {(h.is_last_hit || viewMode === 'all') && (
            <span className="bd-hit-dmg-tags">
              {h.is_last_hit && <span className="settlement-badge-last">막타</span>}
              {viewMode === 'all' && <span className="bd-hit-stage">{h.stage_level}단계</span>}
            </span>
          )}
        </div>
      </td>
      <td className="bd-hit-ratio" title={ratioTitle}>
        {h.ratio != null ? `${h.ratio.toFixed(1)}%` : '-'}
      </td>
    </tr>
  );

  return (
    <div className="settlement-page settlement-print-area"
      style={{ paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined, paddingRight: rightCollapsed ? 'var(--panel-collapse-inset)' : undefined }}>
      <div className="settlement-controls settlement-no-print">
        <button onClick={goBack} style={btnStyle}>← 결산으로</button>
        <h2 style={{ margin: 0, color: 'var(--accent-green)', fontSize: '1.3rem' }}>{bNum}번 보스 결산</h2>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{season}</span>
        <button onClick={() => setShowSquad(!showSquad)} style={{ ...btnStyle, marginLeft: 'auto' }}>
          {showSquad ? '스쿼드 숨기기' : '스쿼드 표시'}
        </button>
        <button onClick={() => setHpMode(hpMode === 'simple' ? 'detail' : 'simple')}
          style={{ ...btnStyle, background: hpMode === 'simple' ? '#3b82f6' : '#ef4444', color: '#fff', border: 'none' }}>
          {hpMode === 'simple' ? '간이 모드' : '상세 모드'}
        </button>
      </div>

      <div className="boss-detail-grid">
        {/* a) 보스 정보 */}
        <div className="bd-card bd-info">
          <div className="bd-info-img-wrap">
            <BossImage url={boss.image_url} alt={boss.image_alt} element={boss.element} size={120} fit="cover" fade={0.1} style={{ width: '100%', height: '100%', borderRadius: 0 }} />
          </div>
          <div className="bd-info-text">
            <div className="bd-info-name">
              {elementIconUrl(boss.element) && (
                <img className="bd-info-element" src={elementIconUrl(boss.element)} alt={boss.element} title={`약점 속성: ${boss.element}`} />
              )}
              {boss.name}
            </div>
            <div className="bd-info-sub">약점 속성: {boss.element} · {boss.boss_grade}</div>
            <div className="bd-info-total">
              총 대미지 <strong>{hpMode === 'simple' ? formatHpJoEok(totalBossDamage) : Number(totalBossDamage).toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* b) 단계별 소모 타수 / 평균 대미지 */}
        <div className="bd-card bd-stages">
          <h3>단계별 소모 타수 · 평균 대미지</h3>
          <div className="bd-table-scroll">
          <table className="bd-mini-table">
            <thead>
              <tr><th>단계</th><th>소모 타수</th><th>평균 대미지</th><th>입힌 피해량</th><th>클리어 시각</th></tr>
            </thead>
            <tbody>
              {stageRows.map(s => (
                <tr key={s.stage_level}>
                  <td>{s.stage_level}단계</td>
                  <td>{s.count}타</td>
                  <td>{s.count > 0 ? formatHp(Math.floor(s.sum / s.count), hpMode) : '-'}</td>
                  <td style={{ color: s.cutPct >= 100 ? 'var(--accent-green)' : 'var(--text-soft)' }}>
                    {s.cutPct != null ? `${s.cutPct.toFixed(1)}%` : '-'}
                  </td>
                  {/* 무한 단계는 클리어가 없으므로 마지막 타수 시각을 대신 보여준다. */}
                  <td style={{ fontSize: '0.78rem', color: s.cleared_at ? 'var(--accent-green)' : (s.isInfinite && s.lastHitAt ? 'var(--accent-amber)' : 'var(--text-dim)') }}
                    title={!s.cleared_at && s.isInfinite && s.lastHitAt ? '무한 단계는 클리어가 없어 마지막 타수 시각을 표시합니다' : undefined}>
                    {s.cleared_at
                      ? formatShortDateTime(s.cleared_at)
                      : (s.isInfinite && s.lastHitAt)
                        ? formatShortDateTime(s.lastHitAt)
                        : (s.is_cleared ? '기록 없음' : '미클리어')}
                  </td>
                </tr>
              ))}
              {stageRows.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-dim)', padding: '1rem' }}>데이터 없음</td></tr>}
            </tbody>
          </table>
          </div>
        </div>

        {/* c) 자주 사용된 니케 5선 */}
        <div className="bd-card bd-nikkes">
          <h3>자주 사용된 니케 5선</h3>
          {nikkeTop.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>데이터 없음</span>
          ) : (
            <div className="bd-nikke-list">
              {nikkeTop.map(n => (
                <div key={n.id} className="bd-nikke-item">
                  <NikkeAvatar nikkeId={n.id} size="56px" style={{ aspectRatio: '1/1' }} />
                  {/* 사용 횟수 + 전체 타수 대비 사용률 */}
                  <div className="bd-nikke-count">
                    {n.count}회
                    {hits.length > 0 && <span className="bd-nikke-rate"> ({Math.round((n.count / hits.length) * 100)}%)</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* d) 타수별 대미지 테이블 */}
        <div className="bd-card bd-hits">
          <div className="bd-hits-head">
            <h3>모의전 결과 (타수별 대미지)</h3>
            <div className="bd-view-toggle settlement-no-print">
              <button type="button" className={viewMode === 'stage' ? 'active' : ''} onClick={() => changeViewMode('stage')}>단계별</button>
              <button type="button" className={viewMode === 'all' ? 'active' : ''} onClick={() => changeViewMode('all')}>전체</button>
            </div>
          </div>
          <div className="bd-table-scroll">
          <table className="bd-mini-table bd-hits-table">
            <thead>
              <tr>
                <SortableTh field="seq" sort={sort}>순번</SortableTh>
                <SortableTh field="name" sort={sort}>닉네임</SortableTh>
                <SortableTh field="synchro" sort={sort}>싱크로</SortableTh>
                {showSquad && <th className="bd-hit-squad-col">스쿼드</th>}
                <SortableTh field="damage" sort={sort}>대미지</SortableTh>
                <SortableTh field="ratio" sort={sort} title={ratioTitle}>
                  비율<span className="bd-th-sub">{viewMode === 'stage' ? '단계 체력' : '보스 총합'}</span>
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {hits.length === 0 ? (
                <tr><td colSpan={hitColSpan} style={{ color: 'var(--text-dim)', padding: '1rem' }}>타수 기록 없음</td></tr>
              ) : viewMode === 'all' ? (
                sort.sorted.map(renderHitRow)
              ) : (
                hitGroups.map(g => (
                  <React.Fragment key={g.level}>
                    <tr className="bd-stage-sep">
                      <td colSpan={hitColSpan}>
                        <span className="bd-stage-sep-title">{g.level}단계</span>
                        <span className="bd-stage-sep-meta">
                          {g.list.length}타
                          {g.stat?.cutPct != null && <> · 입힌 피해량 <strong>{g.stat.cutPct.toFixed(1)}%</strong></>}
                          {g.stat?.cleared_at
                            ? <> · 클리어 {formatShortDateTime(g.stat.cleared_at)}</>
                            : (g.stat?.isInfinite && g.stat?.lastHitAt) && <> · 마지막 타수 {formatShortDateTime(g.stat.lastHitAt)}</>}
                        </span>
                      </td>
                    </tr>
                    {g.list.map(renderHitRow)}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
}
