import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { onGuildChanges } from '../../lib/realtime';
import { useDemo } from '../../demo/DemoContext';
import MockBattleUploadModal from './MockBattleUploadModal';
import ApplyRealDamageModal from './ApplyRealDamageModal';
import DeleteMockModal from './DeleteMockModal';
import BossInfoModal from './BossInfoModal';
import NikkeAvatar from '../../components/NikkeAvatar';
import SquadNikke from '../../components/SquadNikke';
import FitText from '../../components/FitText';
import { usePreferences } from '../../hooks/usePreferences';
import { useBossBattleSeasons } from '../../hooks/useBossBattleSeasons';
import { useGameData } from '../../contexts/GameDataContext';
import { formatHp as fmtHp, formatHpShort } from '../../lib/format';
import { isManager } from '../../lib/roles';
import { makeIdentity } from '../../lib/identity';
import './BossBattleDashboard.css';

// 속성 아이콘 이모지 폴백 (game_icons 미등록 시)
const ELEMENT_ICON = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };

// 시즌당 한 사람이 소모할 수 있는 실전 타수. 이 수에 도달하면 그 인물의 길드 보스전은 종료로 본다.
const MAX_HITS_PER_SEASON = 3;

export default function BossBattleDashboard() {
  const { guild, allMembers, user, role, synchroLevel, setSynchroLevel, leftCollapsed, rightCollapsed, isNarrow } = useOutletContext();
  const demo = useDemo();
  const isAdmin = isManager(role);
  const { gameIcons } = useGameData();
  const elementIconUrl = (element) =>
    gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;

  const [bossBattleStatuses, setBossBattleStatuses] = useState([]);
  const [mockBattles, setMockBattles] = useState([]);
  const [loading, setLoading] = useState(true);
  // 보스 이름 클릭 시 띄우는 보스 정보(모의전 탭의 보스 메모 / 관리자 추천 덱).
  const [bossMemos, setBossMemos] = useState([]);
  const [recommendedSquads, setRecommendedSquads] = useState([]);
  const [bossInfoNum, setBossInfoNum] = useState(null);

  // Modal state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedUploadBossStatus, setSelectedUploadBossStatus] = useState(null);
  const [editMockData, setEditMockData] = useState(null);
  const [applyDamageModal, setApplyDamageModal] = useState({ visible: false, record: null });

  // HP Display Mode
  const { hpMode, setHpMode, showSquad, setShowSquad } = usePreferences();
  const [showCalcMocksInPool, setShowCalcMocksInPool] = useState(false);
  // 모바일: 지휘 현황판 상단 설정 바 접기/펼치기 (공간 확보)
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  // 모바일: 단일 보스 포커스 (좁은 화면에선 보스 하나만 전체폭으로 표시)
  const [focusedBoss, setFocusedBoss] = useState(1);
  // 보스 항목 폭 배율(1~2배). 우측 하단 슬라이더로 조절, localStorage에 유지.
  const [boardScale, setBoardScale] = useState(() => {
    const v = parseFloat(localStorage.getItem('nikke_board_scale'));
    return v >= 1 && v <= 2 ? v : 1;
  });
  const updateBoardScale = (v) => {
    setBoardScale(v);
    try { localStorage.setItem('nikke_board_scale', String(v)); } catch { /* ignore */ }
  };

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, record: null });

  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState({ visible: false, record: null });

  // bossStages tracks the CURRENTLY VIEWED stage for each boss
  const [bossStages, setBossStages] = useState({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 });
  const { seasons, selectedSeason, setSelectedSeason, seasonsReady } = useBossBattleSeasons(guild?.id);
  const [isLockedSeason, setIsLockedSeason] = useState(false);

  // Calculate max stage available based on fetched data
  const maxStageNormal = bossBattleStatuses.length > 0 ? Math.max(...bossBattleStatuses.filter(r => r.global_raid_bosses.boss_number !== 5).map(r => r.stage_level)) : 3;
  const maxStageBoss5 = bossBattleStatuses.length > 0 ? Math.max(...bossBattleStatuses.filter(r => r.global_raid_bosses.boss_number === 5).map(r => r.stage_level)) : 4;

  // 시즌이 없으면 로딩 종료 (기존 fetchSeasons의 setLoading(false) 대체)
  useEffect(() => {
    if (seasonsReady && seasons.length === 0) setLoading(false);
  }, [seasonsReady, seasons.length]);

  // 2. Fetch bossBattle data when selectedSeason changes
  const fetchBossBattleData = async () => {
    if (!selectedSeason || !guild?.id) return;

    // 체험 모드: 목업 스토어에서 시즌 데이터를 구성
    if (demo.isDemo) {
      const d = demo.data;
      if (!d) return;
      const statuses = d.bossBattleStatuses.filter(s => s.global_raid_bosses.season_name === selectedSeason);
      const statusIds = statuses.map(s => s.id);
      const battles = d.mockBattles.filter(b => statusIds.includes(b.boss_status_id));
      const initialBossStages = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
      [1, 2, 3, 4, 5].forEach(bNum => {
        const uncleared = statuses.filter(s => s.global_raid_bosses.boss_number === bNum && !s.is_cleared).map(s => s.stage_level);
        if (uncleared.length > 0) {
          initialBossStages[bNum] = Math.min(...uncleared);
        } else {
          const cleared = statuses.filter(s => s.global_raid_bosses.boss_number === bNum && s.is_cleared).map(s => s.stage_level);
          if (cleared.length > 0) initialBossStages[bNum] = Math.min(Math.max(...cleared) + 1, bNum === 5 ? 4 : 3);
        }
      });
      setIsLockedSeason(false);
      setBossBattleStatuses(statuses);
      setMockBattles(battles);
      setBossMemos(d.bossMemos.filter(m => m.season_name === selectedSeason));
      setRecommendedSquads(d.recommendedSquads.filter(s => s.season_name === selectedSeason));
      setBossStages(initialBossStages);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: statuses, error: statusErr } = await supabase
        .from('union_raid_status')
        .select(`
          id, stage_level, current_hp, is_cleared,
          global_raid_bosses!inner ( id, boss_number, name, element, boss_grade, season_name )
        `)
        .eq('union_id', guild.id)
        .eq('global_raid_bosses.season_name', selectedSeason);

      if (statusErr) throw statusErr;

      const statusIds = statuses ? statuses.map(s => s.id) : [];
      let battles = [];

      if (statusIds.length > 0) {
        const { data: bData, error: battleErr } = await supabase
          .from('mock_battles')
          .select('*')
          .eq('union_id', guild.id)
          .in('boss_status_id', statusIds);

        if (battleErr) throw battleErr;
        battles = bData;
      }

      // Calculate max cleared stage for each boss and advance
      const initialBossStages = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
      if (statuses && statuses.length > 0) {
        [1, 2, 3, 4, 5].forEach(bNum => {
          const unclearedStages = statuses.filter(s => s.global_raid_bosses.boss_number === bNum && !s.is_cleared).map(s => s.stage_level);
          if (unclearedStages.length > 0) {
            initialBossStages[bNum] = Math.min(...unclearedStages);
          } else {
            const clearedStages = statuses.filter(s => s.global_raid_bosses.boss_number === bNum && s.is_cleared).map(s => s.stage_level);
            if (clearedStages.length > 0) {
              const maxCleared = Math.max(...clearedStages);
              let maxLimit = bNum === 5 ? 4 : 3;
              initialBossStages[bNum] = Math.min(maxCleared + 1, maxLimit);
            }
          }
        });
      }

      // 잠금 상태 + 보스 정보 모달에 쓸 보스 메모 / 관리자 추천 덱 (모의전 탭과 같은 소스)
      const [lockRes, memoRes, squadRes] = await Promise.all([
        supabase.from('union_raid_season_settings').select('is_locked')
          .eq('union_id', guild.id).eq('season_name', selectedSeason).maybeSingle(),
        supabase.from('union_boss_memos').select('*')
          .eq('union_id', guild.id).eq('season_name', selectedSeason),
        supabase.from('recommended_squads').select('*')
          .eq('union_id', guild.id).eq('season_name', selectedSeason),
      ]);

      setIsLockedSeason(lockRes.data?.is_locked || false);
      setBossMemos(memoRes.data || []);
      setRecommendedSquads(squadRes.data || []);

      setBossBattleStatuses(statuses || []);
      setMockBattles(battles || []);
      setBossStages(initialBossStages);
    } catch (err) {
      console.error("Failed to fetch bossBattle data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    // 체험 모드: realtime 구독 없이 스토어에서 재조회 (demo.rev 변경 시 자동 재실행)
    if (demo.isDemo) {
      fetchBossBattleData();
      return () => { isMounted = false; };
    }

    if (guild?.id) {
      fetchBossBattleData();

      // Realtime Subscriptions (고유 채널명으로 재구독 충돌 방지)
      const rtId = Date.now();
      const statusChannel = supabase.channel(`boss_battle_dashboard_status_${rtId}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'union_raid_status', filter: `union_id=eq.${guild.id}` }, payload => {
          setBossBattleStatuses(prev => prev.map(rs => rs.id === payload.new.id ? { ...rs, ...payload.new } : rs));
        })
        .subscribe();

      const mockChannel = supabase.channel(`boss_battle_dashboard_mocks_${rtId}`);
      onGuildChanges(mockChannel, 'mock_battles', guild.id, payload => {
        if (payload.new && payload.new.union_id && payload.new.union_id !== guild.id) return;
        if (payload.eventType === 'INSERT') {
          setMockBattles(prev => [...prev, payload.new]);
        } else if (payload.eventType === 'UPDATE') {
          // union_raid_status는 별도 statusChannel로 이미 실시간 반영되므로 여기서 다시
          // fetchBossBattleData()를 부르지 않는다 — 그 함수는 bossStages(각자 보고 있던 보스 단계)도
          // 다시 계산해버려서, 다른 유저가 타수를 완료할 때마다 모든 접속자의 화면이 강제로
          // 다음 단계로 넘어가는 부작용이 있었다.
          setMockBattles(prev => prev.map(mb => mb.id === payload.new.id ? { ...mb, ...payload.new } : mb));
        } else if (payload.eventType === 'DELETE') {
          setMockBattles(prev => prev.filter(mb => mb.id !== payload.old.id));
        }
      });
      // 보스 정보 모달용. 관리자가 모의전 탭에서 메모/추천 덱을 고치면 현황판에도 바로 반영된다.
      onGuildChanges(mockChannel, 'union_boss_memos', guild.id, payload => {
        if (payload.new && payload.new.union_id && payload.new.union_id !== guild.id) return;
        if (payload.eventType === 'INSERT') {
          setBossMemos(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new]);
        } else if (payload.eventType === 'UPDATE') {
          setBossMemos(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
        } else if (payload.eventType === 'DELETE') {
          setBossMemos(prev => prev.filter(m => m.id !== payload.old.id));
        }
      });
      onGuildChanges(mockChannel, 'recommended_squads', guild.id, payload => {
        if (payload.new && payload.new.union_id && payload.new.union_id !== guild.id) return;
        if (payload.eventType === 'INSERT') {
          setRecommendedSquads(prev => prev.some(s => s.id === payload.new.id) ? prev : [...prev, payload.new]);
        } else if (payload.eventType === 'UPDATE') {
          setRecommendedSquads(prev => prev.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s));
        } else if (payload.eventType === 'DELETE') {
          setRecommendedSquads(prev => prev.filter(s => s.id !== payload.old.id));
        }
      });
      mockChannel.subscribe();

      return () => {
        isMounted = false;
        supabase.removeChannel(statusChannel);
        supabase.removeChannel(mockChannel);
      };
    }
  }, [guild, selectedSeason, demo.isDemo, demo.rev]);

  const handleStageChange = (bossNum, delta) => {
    setBossStages(prev => {
      const current = prev[bossNum];
      let maxLimit = bossNum === 5 ? maxStageBoss5 : maxStageNormal;
      let next = current + delta;
      if (next < 1) next = 1;
      if (next > maxLimit) next = maxLimit;
      return { ...prev, [bossNum]: next };
    });
  };

  // 타수 집계용 식별: 닉네임+싱크로가 같으면 본인 작성/관리자 수기 기록을 동일 인물로 합친다.
  const identity = useMemo(() => makeIdentity(allMembers), [allMembers]);
  const identityKey = identity.identityKey;

  const usedNikkesByUserId = useMemo(() => {
    const map = {};
    mockBattles.forEach(mb => {
      if (mb.status === 'completed' || mb.is_in_calc) {
        if (!map[identityKey(mb)]) map[identityKey(mb)] = new Set();
        if (mb.slot_1_nikke_id) map[identityKey(mb)].add(mb.slot_1_nikke_id);
        if (mb.slot_2_nikke_id) map[identityKey(mb)].add(mb.slot_2_nikke_id);
        if (mb.slot_3_nikke_id) map[identityKey(mb)].add(mb.slot_3_nikke_id);
        if (mb.slot_4_nikke_id) map[identityKey(mb)].add(mb.slot_4_nikke_id);
        if (mb.slot_5_nikke_id) map[identityKey(mb)].add(mb.slot_5_nikke_id);
      }
    });
    return map;
  }, [mockBattles, identityKey]);

  const completedCountByIdentity = useMemo(() => {
    const counts = {};
    mockBattles.forEach(mb => {
      if (mb.status === 'completed') {
        const key = identityKey(mb)
        counts[key] = (counts[key] || 0) + 1;
      }
    });
    return counts;
  }, [mockBattles, identityKey]);

  // 3타수를 모두 소모한 인물 = 이번 시즌 길드 보스전 종료. 이들의 대기/계산 기록은 현황판에서 감춘다.
  //
  // 서버(apply_real_battle_damage)도 3타 도달 시 남은 기록을 모의전 탭으로 내리지만, 그 판정은
  // user_id / manual_nickname 단일 기준이라 "본인 작성 + 관리자 수기"가 섞인 인물에서는 3타를
  // 인식하지 못해 기록이 대기열에 그대로 남는 문제가 있었다. 화면 쪽은 identity.js의 병합 규칙
  // (닉네임+싱크로)으로 판정해, 서버 하강이 실패했거나 이미 남아버린 기록도 노출되지 않게 한다.
  // 타수를 되돌리면(3타 미만으로 내려가면) 다시 자동으로 나타난다.
  const exhaustedIdentityKeys = useMemo(() => {
    const keys = new Set();
    Object.entries(completedCountByIdentity).forEach(([key, count]) => {
      if (count >= MAX_HITS_PER_SEASON) keys.add(key);
    });
    return keys;
  }, [completedCountByIdentity]);

  // 실전(완료 타수)에서 사용된 니케만 따로 집계 → "실전 사용됨" 빨간 표시용. (계산기 전용과 구분)
  const battleUsedByIdentity = useMemo(() => {
    const map = {};
    mockBattles.forEach(mb => {
      if (mb.status === 'completed') {
        const key = identityKey(mb);
        if (!map[key]) map[key] = new Set();
        [mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id, mb.slot_4_nikke_id, mb.slot_5_nikke_id]
          .forEach(nid => { if (nid) map[key].add(nid); });
      }
    });
    return map;
  }, [mockBattles, identityKey]);

  const isUsedNikke = (userId, nid) => usedNikkesByUserId[userId]?.has(nid);
  const isBattleUsedNikke = (idKey, nid) => battleUsedByIdentity[idKey]?.has(nid);

  const formatHp = (hp) => fmtHp(hp, hpMode);
  // 지휘 현황판 보스 헤더 표기: 간단 → "#조 #억"(조 단위면 소수점 제거), 상세 → 천단위 콤마.
  const boardHp = (hp) => (hpMode === 'simple' ? formatHpShort(hp) : fmtHp(hp, 'detail'));

  const handleJumpToLatest = () => {
    if (seasons.length > 0) {
      setSelectedSeason(seasons[0].name);
    }
  };

  const handleRevertMock = async (mb, currentBossStatus) => {
    if (!confirm('실전 타수를 다시 계산기로 되돌리시겠습니까?')) return;
    try {
      const restoreAmount = mb.is_last_hit ? mb.expected_damage : mb.real_damage;
      // 무한(4단계) 보스는 적용 시 체력을 누적(+)했으므로, 되돌릴 때는 반대로 차감(-)해야 한다.
      const isInfinite = currentBossStatus?.global_raid_bosses?.boss_number === 5
        && currentBossStatus?.stage_level === maxStageBoss5;

      // 체험 모드: 스토어에서 되돌리기 (HP 복구 + pending 복귀)
      if (demo.isDemo) {
        demo.revertRealDamage({ mockBattleId: mb.id, bossStatusId: currentBossStatus.id, restore: isInfinite ? -Number(restoreAmount) : Number(restoreAmount) });
        alert('성공적으로 계산기로 복구되었습니다!');
        return;
      }

      // 체력 복구도 원자적 RPC로 처리한다 — apply_real_battle_damage와 동일한 이유로,
      // 읽어온 값 기준 절대값 덮어쓰기 대신 대상 행을 잠그고 현재 DB 값에서 되돌린다.
      // 결과는 실시간 채널(statusChannel/mockChannel)로 자동 반영되므로 여기서 fetchBossBattleData()를
      // 다시 부르지 않는다 — bossStages(보고 있던 보스 단계)를 불필요하게 재계산하지 않기 위함.
      const { data, error } = await supabase.rpc('revert_real_battle_damage', {
        p_mock_battle_id: mb.id,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;

      if (result?.code !== 'reverted') {
        alert('복구 실패: ' + (result?.code || '알 수 없는 응답'));
        return;
      }

      alert('성공적으로 계산기로 복구되었습니다!');
    } catch (err) {
      console.error(err);
      alert('복구 실패: ' + err.message);
    }
  };

  if (loading && seasons.length === 0) {
    return <div style={{ color: 'var(--text-strong)', padding: '2rem' }}>로딩 중...</div>;
  }

  if (!loading && seasons.length === 0) {
    return (
      <div style={{ color: 'var(--text-strong)', padding: '2rem', textAlign: 'center' }}>
        <h2>데이터 없음</h2>
        <p>현재 길드에 등록된 보스전 데이터가 없습니다. 길드 관리자가 설정에서 지휘 기록을 먼저 생성해야 합니다.</p>
      </div>
    );
  }

  const getMemberName = (userId) => {
    const m = allMembers.find(x => x.user_id === userId);
    return m ? m.in_game_name : '삭제됨';
  };

  // 상단 설정 바의 개별 컨트롤 (데스크톱/모바일 공유)
  const seasonSelect = (
    <select
      value={selectedSeason}
      onChange={(e) => setSelectedSeason(e.target.value)}
      style={{ padding: '6px', borderRadius: '4px', background: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-1)' }}
    >
      {seasons.map(s => (
        <option key={s.name} value={s.name}>{s.name}</option>
      ))}
    </select>
  );
  const jumpToLatestBtn = (
    <button
      onClick={handleJumpToLatest}
      style={{ padding: '6px 12px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
    >
      현재 시즌
    </button>
  );
  const squadToggleBtn = (
    <button
      onClick={() => setShowSquad(!showSquad)}
      style={{ background: 'transparent', border: '1px solid var(--border-3)', color: 'var(--text-soft)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
    >
      스쿼드 {showSquad ? '숨기기' : '표시'}
    </button>
  );
  const calcMocksLabel = isAdmin && (
    <label style={{ fontSize: '0.85rem' }}>
      <input
        type="checkbox"
        checked={showCalcMocksInPool}
        onChange={(e) => setShowCalcMocksInPool(e.target.checked)}
      /> 현황판(계산기)에 올린 타수 포함 보기
    </label>
  );
  const hpModeBtn = (
    <button
      onClick={() => setHpMode(hpMode === 'simple' ? 'detail' : 'simple')}
      style={{ fontSize: '0.85rem', padding: '6px 12px', background: hpMode === 'simple' ? '#3b82f6' : '#ef4444', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
    >
      {hpMode === 'simple' ? '간이 모드' : '상세 모드'}
    </button>
  );

  const renderTopControls = () => {
    // 모바일: 제목은 가로 고정, 컨트롤은 2줄 wrap + 접기/펼치기로 공간 확보
    if (isNarrow) {
      return (
        <div className="board-controls board-controls--mobile" style={{ paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined }}>
          <div className="board-controls-title-row">
            <span className="board-title-text">지휘 현황판</span>
            <button
              className="board-controls-toggle"
              onClick={() => setControlsCollapsed(c => !c)}
              aria-label={controlsCollapsed ? '설정 펼치기' : '설정 접기'}
            >
              {controlsCollapsed ? '설정 ▾' : '설정 ▴'}
            </button>
          </div>
          {!controlsCollapsed && (
            <div className="board-controls-actions">
              {seasonSelect}
              {jumpToLatestBtn}
              {squadToggleBtn}
              {hpModeBtn}
              {calcMocksLabel}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="board-controls" style={{ paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined, paddingRight: rightCollapsed ? 'var(--panel-collapse-inset)' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ fontWeight: 'bold', color: 'var(--accent-amber)', fontSize: '1.2rem' }}>
            지휘 현황판        </div>
          {seasonSelect}
          {jumpToLatestBtn}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          {squadToggleBtn}
          {calcMocksLabel}
          {hpModeBtn}
        </div>
      </div>
    );
  };

  // Get unique bosses 1 to 5
  const bossNumbers = [1, 2, 3, 4, 5];

  return (
    <div className={`boss-battle-board-container${isNarrow ? ' narrow' : ''}`}>
      <div className="boss-battle-board">
        {renderTopControls()}

        {isNarrow && (
          <div className="board-boss-tabs">
            {bossNumbers.map(bNum => {
              const bs = bossBattleStatuses.find(rs => rs.global_raid_bosses.boss_number === bNum);
              const nm = bs?.global_raid_bosses?.name;
              const el = bs?.global_raid_bosses?.element;
              const elUrl = elementIconUrl(el);
              return (
                <button
                  key={bNum}
                  className={`board-boss-tab ${focusedBoss === bNum ? 'active' : ''}`}
                  onClick={() => setFocusedBoss(bNum)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                >
                  {el && (elUrl
                    ? <img src={elUrl} alt={el} style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
                    : <span>{ELEMENT_ICON[el] || ''}</span>)}
                  {nm || `${bNum}번 보스`}
                </button>
              );
            })}
          </div>
        )}

        <div className="boss-columns">
          {(isNarrow ? [focusedBoss] : bossNumbers).map(bNum => {
            const currentViewStage = bossStages[bNum];
            // Find the record for this boss and this stage
            const bossStatus = bossBattleStatuses.find(rs => rs.global_raid_bosses.boss_number === bNum && rs.stage_level === currentViewStage);

            if (!bossStatus) return (
              <div key={bNum} className="boss-col" style={{ padding: '20px', color: 'var(--text-dim)' }}>
                데이터 없음 ({bNum}번 보스 {currentViewStage}단계)
              </div>
            );

            const bossInfo = bossStatus.global_raid_bosses;
            const isInfinite = bNum === 5 && currentViewStage === maxStageBoss5;
            const isCleared = bossStatus.is_cleared;

            // Filter queue mocks (Pool): same boss number, pending, queued, not in calc (unless showCalcMocksInPool)
            // 3타수를 모두 소모한 인물의 기록은 대기열/계산기 어디에도 남기지 않는다.
            const queueMocks = mockBattles.filter(mb => {
              const rs = bossBattleStatuses.find(s => s.id === mb.boss_status_id);
              return rs && rs.global_raid_bosses.boss_number === bNum && mb.status === 'pending' && mb.is_queued === true && (!mb.is_in_calc || showCalcMocksInPool)
                && !exhaustedIdentityKeys.has(identityKey(mb));
            });
            // 계산기는 '지금 보고 있는 단계'에 올린 기록만 담는다. 계산기로 옮길 때
            // boss_status_id를 그 단계의 것으로 바꿔 저장하므로(handleToggleCalc), 보스 번호가
            // 아니라 boss_status_id로 걸러야 1단계에 넣은 기록이 2~4단계에도 같이 뜨지 않는다.
            // (아래 calcDmgSum도 이 목록을 쓰므로 '계산 적용' 체력이 단계별로 맞아떨어진다.)
            const calcMocks = mockBattles.filter(mb =>
              mb.boss_status_id === bossStatus.id && mb.status === 'pending' && mb.is_queued === true && mb.is_in_calc
              && !exhaustedIdentityKeys.has(identityKey(mb))
            );
            const completedMocks = mockBattles.filter(mb => {
              const rs = bossBattleStatuses.find(s => s.id === mb.boss_status_id);
              return rs && rs.global_raid_bosses.boss_number === bNum && rs.stage_level === currentViewStage && mb.status === 'completed';
            });

            const calcDmgSum = calcMocks.reduce((sum, mb) => sum + Number(mb.expected_damage), 0);
            const rawCalcHp = bossStatus.current_hp - calcDmgSum;
            const calcAppliedHp = Math.max(0, rawCalcHp);
            const isOverkill = rawCalcHp < 0;
            const overkillAmount = Math.abs(rawCalcHp);
            const calcAppliedInfinite = (bossStatus.current_hp || 0) + calcDmgSum;

            const handleToggleCalc = async (mb) => {
              if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
              if (!isAdmin) return;
              try {
                const newIsInCalc = !mb.is_in_calc;

                if (newIsInCalc) {
                  const hits = completedCountByIdentity[identityKey(mb)] || 0;
                  if (hits >= MAX_HITS_PER_SEASON) {
                    alert('이미 3타수를 모두 소모한 유저는 계산기에 기록을 추가할 수 없습니다.');
                    return;
                  }

                  const usedNikkes = usedNikkesByUserId[identityKey(mb)] || new Set();
                  const squad = [mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id, mb.slot_4_nikke_id, mb.slot_5_nikke_id].filter(Boolean);
                  const alreadyUsed = squad.some(nid => usedNikkes.has(nid));
                  if (alreadyUsed) {
                    alert('이미 사용된 니케가 포함되어 있어 계산기에 추가할 수 없습니다.');
                    return;
                  }
                }

                const newBossStatusId = newIsInCalc ? bossStatus.id : mb.boss_status_id;

                setMockBattles(prev => prev.map(m => m.id === mb.id ? { ...m, is_in_calc: newIsInCalc, boss_status_id: newBossStatusId } : m));
                if (demo.isDemo) {
                  demo.updateMockBattle(mb.id, { is_in_calc: newIsInCalc, boss_status_id: newBossStatusId });
                } else {
                  await supabase.from('mock_battles').update({ is_in_calc: newIsInCalc, boss_status_id: newBossStatusId }).eq('id', mb.id);
                }
              } catch (err) {
                console.error(err);
                setMockBattles(prev => prev.map(m => m.id === mb.id ? { ...m, is_in_calc: mb.is_in_calc, boss_status_id: mb.boss_status_id } : m));
              }
            };

            return (
              <div key={bNum} className="boss-col" style={{ opacity: isCleared ? 0.6 : 1, ...(!isNarrow ? { flex: `1 0 ${Math.round(250 * boardScale)}px`, minWidth: `${Math.round(250 * boardScale)}px` } : {}) }}>
                <div className="boss-header" style={{ position: 'relative' }}>
                  {/* Per-boss stage selector */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <button onClick={() => handleStageChange(bNum, -1)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontWeight: 'bold' }}>◀</button>
                    <span style={{ fontSize: '0.9rem', color: 'var(--accent-amber)', fontWeight: 'bold' }}>{currentViewStage}단계</span>
                    <button onClick={() => handleStageChange(bNum, 1)} style={{ background: 'none', border: 'none', color: 'var(--text-faint)', cursor: 'pointer', fontWeight: 'bold' }}>▶</button>
                  </div>

                  {/* 각 칸/줄 높이를 고정해 글자 크기가 줄어도 레이아웃이 밀리지 않도록 한다. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem', textAlign: 'left', backgroundColor: 'var(--surface-1)', padding: '10px', borderRadius: '4px' }}>
                    {/* 보스 이름 클릭 → 모의전 탭의 보스 메모 / 관리자 추천 덱을 모달로 */}
                    <div
                      onClick={() => setBossInfoNum(bNum)}
                      style={{ minWidth: 0, overflow: 'hidden', height: '22px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                    >
                      <FitText
                        text={bossInfo.name} maxPx={16} minPx={10} widthRatio={0.98} weight="bold"
                        title={`${bossInfo.name} — 클릭하여 보스 메모 / 추천 덱 보기`}
                        style={{ lineHeight: '22px', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: '3px', textDecorationColor: 'var(--text-faint)' }}
                      />
                    </div>
                    <div style={{ color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '3px', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', height: '22px' }}>
                      <span>약점: {bossInfo.element}</span>
                      {elementIconUrl(bossInfo.element)
                        ? <img src={elementIconUrl(bossInfo.element)} alt={bossInfo.element} style={{ width: '1em', height: '1em', objectFit: 'contain' }} />
                        : <span>{ELEMENT_ICON[bossInfo.element] || ''}</span>}
                    </div>
                    <div style={{ color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden' }}>
                      계산 적용:
                      <div style={{ height: '20px', display: 'flex', alignItems: 'center' }}>
                        <FitText
                          text={isInfinite ? boardHp(calcAppliedInfinite) : (isOverkill ? `(오버킬) ${boardHp(overkillAmount)}` : boardHp(calcAppliedHp))}
                          maxPx={15} minPx={9} widthRatio={0.9} weight="bold"
                          color={isInfinite ? 'var(--accent-blue)' : (isOverkill ? '#a855f7' : 'var(--danger)')}
                          style={{ lineHeight: '20px' }}
                        />
                      </div>
                    </div>
                    <div style={{ color: 'var(--text-muted)', minWidth: 0, overflow: 'hidden' }}>
                      {isInfinite ? '가한 대미지' : '실제 체력'}:
                      <div style={{ height: '20px', display: 'flex', alignItems: 'center' }}>
                        {(!isInfinite && isCleared) ? (
                          <span style={{ color: 'var(--accent-green)', fontWeight: 'bold', lineHeight: '20px' }}>토벌 완료</span>
                        ) : (
                          <FitText
                            text={boardHp(bossStatus.current_hp)}
                            maxPx={15} minPx={9} widthRatio={0.9} weight="bold"
                            color={isInfinite ? 'var(--accent-blue)' : 'var(--text-soft)'}
                            style={{ lineHeight: '20px' }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pool-area">
                  <button
                    onClick={() => {
                      if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
                      setSelectedUploadBossStatus(bossBattleStatuses.find(rs => rs.global_raid_bosses.boss_number === bNum));
                      setIsUploadModalOpen(true);
                    }}
                    style={{ width: '100%', padding: '8px', marginBottom: '10px', background: isLockedSeason ? 'var(--border-3)' : 'var(--accent-green)', color: isLockedSeason ? 'var(--text-soft)' : 'black', fontWeight: 'bold', border: 'none', borderRadius: '4px', cursor: isLockedSeason ? 'not-allowed' : 'pointer' }}
                  >
                    + 모의전 업로드                  </button>
                  <div className="cards-container">
                    {queueMocks.map(mb => (
                      <div
                        key={mb.id}
                        className="mock-card"
                        onDoubleClick={() => handleToggleCalc(mb)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!isAdmin && mb.user_id !== user?.id) return;
                          setContextMenu({ visible: true, x: e.pageX, y: e.pageY, record: mb, bossStatus });
                        }}
                        style={{
                          cursor: (isAdmin || mb.user_id === user?.id) ? 'pointer' : 'default',
                          padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px'
                        }}
                        title={(isAdmin || mb.user_id === user?.id) ? "더블 클릭하여 계산기로 이동" : ""}
                      >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: 'start', paddingBottom: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                  {mb.is_in_calc && <span style={{ color: 'var(--accent-amber)', fontSize: '0.75rem', marginRight: '5px' }}>({bossBattleStatuses.find(r => r.id === mb.boss_status_id)?.stage_level}단계)</span>}
                                  {mb.is_admin_written ? (
                                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 'bold' }}>* {mb.manual_nickname} <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}>({mb.synchro_level})</span></span>
                                  ) : (
                                    <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{getMemberName(mb.user_id)} <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}>({mb.synchro_level})</span></span>
                                  )}
                                </div>
                              </td>
                              <td style={{ textAlign: 'end', paddingBottom: '4px', whiteSpace: 'nowrap' }}>
                                <span style={{ fontWeight: 'bold' }}>{formatHp(mb.expected_damage)}</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        {showSquad && (
                          <div style={{ display: 'flex', gap: '2%', justifyContent: 'center', marginTop: '4px', width: '100%' }}>
                            {[mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id, mb.slot_4_nikke_id, mb.slot_5_nikke_id].filter(Boolean).map((nid, i) => (
                              <SquadNikke key={i} nikkeId={nid} used={isUsedNikke(identityKey(mb), nid)} battleUsed={isBattleUsedNikke(identityKey(mb), nid)} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {queueMocks.length === 0 && (
                      <div style={{ textAlign: 'center', color: '#666', fontSize: '0.8rem', marginTop: '20px' }}>대기열 없음</div>
                    )}
                  </div>
                </div>

                {/* 계산기 (Calc) */}
                <div className="calc-area">
                  <div className="section-title">계산기</div>
                  <div className="cards-container">
                    {calcMocks.map(mb => (
                      <div
                        key={mb.id}
                        className="mock-card"
                        onDoubleClick={() => handleToggleCalc(mb)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!isAdmin && mb.user_id !== user?.id) return;
                          setContextMenu({ visible: true, x: e.pageX, y: e.pageY, record: mb, bossStatus });
                        }}
                        style={{
                          cursor: (isAdmin || mb.user_id === user?.id) ? 'pointer' : 'default',
                          backgroundColor: 'var(--surface-4)', borderLeft: '3px solid var(--accent-amber)',
                          padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px'
                        }}
                        title={(isAdmin || mb.user_id === user?.id) ? "더블 클릭하여 대기열로 복귀" : ""}
                      >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: 'start', paddingBottom: '4px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                  {mb.is_admin_written ? (
                                    <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 'bold' }}>* {mb.manual_nickname} <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}>({mb.synchro_level})</span></span>
                                  ) : (
                                    <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{getMemberName(mb.user_id)} <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}>({mb.synchro_level})</span></span>
                                  )}
                                </div>
                              </td>
                              <td style={{ textAlign: 'end', paddingBottom: '4px', whiteSpace: 'nowrap' }}>
                                <span style={{ color: 'var(--accent-amber)', fontWeight: 'bold' }}>{formatHp(mb.expected_damage)}</span>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                        {showSquad && (
                          <div style={{ display: 'flex', gap: '2%', justifyContent: 'center', marginTop: '4px', width: '100%' }}>
                            {[mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id, mb.slot_4_nikke_id, mb.slot_5_nikke_id].filter(Boolean).map((nid, i) => (
                              <SquadNikke key={i} nikkeId={nid} used={isUsedNikke(identityKey(mb), nid)} battleUsed={isBattleUsedNikke(identityKey(mb), nid)} />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {calcMocks.length === 0 && (
                      <div style={{ textAlign: 'center', color: '#666', fontSize: '0.8rem', marginTop: '20px' }}>계산기 비어있음</div>
                    )}
                  </div>

                  {/* 실전 완료 (Completed) */}
                  <div className="completed-area" style={{ marginTop: '15px' }}>
                    <div className="section-title" style={{ color: 'var(--accent-green)' }}>완료된 타수 (실전)</div>
                    <div className="cards-container">
                      {completedMocks.map(mb => {
                        const diff = Number(mb.real_damage) - Number(mb.expected_damage);
                        const diffText = diff > 0
                          ? `+${hpMode === 'simple' ? (diff / 100000000).toFixed(1) + '억' : diff.toLocaleString()}`
                          : `${hpMode === 'simple' ? (Math.abs(diff) / 100000000).toFixed(1) + '억' : Math.abs(diff).toLocaleString()}`;

                        const isOverkill = mb.is_last_hit && diff < 0;

                        return (
                          <div
                            key={mb.id}
                            className="mock-card"
                            onContextMenu={(e) => {
                              e.preventDefault();
                              if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
                              if (!isAdmin) return;
                              setContextMenu({ visible: true, x: e.pageX, y: e.pageY, record: mb, bossStatus });
                            }}
                            style={{
                              cursor: isAdmin ? 'context-menu' : 'default',
                              backgroundColor: '#1e293b', borderLeft: '3px solid var(--accent-green)',
                              padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px'
                            }}
                          >
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed' }}>
                              <tbody>
                                <tr>
                                  <td style={{ textAlign: 'start', paddingBottom: '4px', width: '45%', overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                      {mb.is_last_hit && (
                                        <span style={{ color: 'var(--accent-green)', fontSize: '0.75rem', fontWeight: 'bold', border: '1px solid var(--accent-green)', borderRadius: '4px', padding: '0 4px' }}>막타</span>
                                      )}
                                      {mb.is_admin_written ? (
                                        <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap', fontWeight: 'bold' }}>* {mb.manual_nickname} <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}>({mb.synchro_level})</span></span>
                                      ) : (
                                        <span style={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>{getMemberName(mb.user_id)} <span style={{ color: 'var(--text-dim)', fontWeight: 'normal' }}>({mb.synchro_level})</span></span>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ textAlign: 'end', paddingBottom: '4px', width: '55%', minWidth: 0, overflow: 'hidden' }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1 }}>(모의)</div>
                                    <FitText text={formatHp(mb.expected_damage)} maxPx={13} minPx={8} widthRatio={0.98} color="var(--text-soft)" style={{ lineHeight: '16px' }} />
                                  </td>
                                </tr>
                                <tr>
                                  <td style={{ textAlign: 'start', overflow: 'hidden', minWidth: 0 }}>
                                    <div style={{ color: diff > 0 ? 'var(--accent-green)' : (diff < 0 ? 'var(--danger)' : 'var(--text-soft)'), fontSize: '0.72rem', lineHeight: 1 }}>
                                      {isOverkill ? '(오버킬)' : `차이 : (${((diff / Number(mb.expected_damage)) * 100).toFixed(1)}%)`}
                                    </div>
                                    <FitText
                                      text={isOverkill ? diffText : `${diff < 0 ? '-' : ''}${diffText}`}
                                      maxPx={14} minPx={8} widthRatio={0.98}
                                      color={diff > 0 ? 'var(--accent-green)' : (diff < 0 ? 'var(--danger)' : 'var(--text-soft)')}
                                      style={{ lineHeight: '18px' }}
                                    />
                                  </td>
                                  <td style={{ textAlign: 'end', minWidth: 0, overflow: 'hidden' }}>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', lineHeight: 1 }}>(실전)</div>
                                    <FitText text={formatHp(mb.real_damage)} maxPx={14} minPx={8} widthRatio={0.98} weight="bold" color="var(--accent-green)" style={{ lineHeight: '18px' }} />
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                            {showSquad && (
                              <div style={{ display: 'flex', gap: '2%', justifyContent: 'center', marginTop: '8px', width: '100%' }}>
                                {[mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id, mb.slot_4_nikke_id, mb.slot_5_nikke_id].filter(Boolean).map((nid, i) => (
                                  <NikkeAvatar key={i} nikkeId={nid} size="18%" style={{ aspectRatio: '1/1', filter: isUsedNikke(identityKey(mb), nid) ? 'grayscale(100%) opacity(0.4)' : 'none' }} />
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!isNarrow && (
          <div className="board-scale-slider" title="보스 항목 폭 조절">
            <span className="board-scale-slider__label">폭</span>
            <input
              type="range" min="1" max="2" step="0.05"
              value={boardScale}
              onChange={(e) => updateBoardScale(parseFloat(e.target.value))}
            />
            <span className="board-scale-slider__val">×{boardScale.toFixed(2)}</span>
          </div>
        )}
      </div>

      <MockBattleUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          setEditMockData(null);
        }}
        bossStatus={selectedUploadBossStatus}
        guild={guild}
        user={user}
        isAdmin={isAdmin}
        allMembers={allMembers}
        bossBattleStatuses={bossBattleStatuses}
        synchroLevel={synchroLevel}
        setSynchroLevel={setSynchroLevel}
        editData={editMockData}
        usedNikkesByUserId={usedNikkesByUserId}
        battleUsedByIdentity={battleUsedByIdentity}
        exhaustedIdentityKeys={exhaustedIdentityKeys}
        getIdentityKey={identityKey}
        onUploadComplete={() => {
          setIsUploadModalOpen(false);
          setEditMockData(null);
          // Realtime takes care of updating mockBattles array
        }}
      />

      {/* Context Menu */}
      {contextMenu.visible && (
        <>
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }} onClick={() => setContextMenu({ visible: false, x: 0, y: 0, record: null })}></div>
          <div style={{ position: 'absolute', top: contextMenu.y, left: contextMenu.x, backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-1)', borderRadius: '4px', padding: '5px', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '150px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>

            {contextMenu.record?.status !== 'completed' && (isAdmin || contextMenu.record?.user_id === user?.id) && (
              <button
                onClick={() => {
                  setSelectedUploadBossStatus(bossBattleStatuses.find(rs => rs.id === contextMenu.record.boss_status_id));
                  setEditMockData(contextMenu.record);
                  setIsUploadModalOpen(true);
                  setContextMenu({ visible: false, x: 0, y: 0, record: null });
                }}
                style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--text-strong)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                ✏️ 수정
              </button>
            )}

            {(() => {
              const rec = contextMenu.record;
              const bStatus = contextMenu.bossStatus;
              if (!rec || !bStatus) return null;

              if (rec.status === 'completed') {
                return (
                  <>
                    {isAdmin && (
                      <button
                        onClick={() => {
                          handleRevertMock(rec, bStatus);
                          setContextMenu({ visible: false, x: 0, y: 0, record: null });
                        }}
                        style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: '#ffeb3b', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        ⏪ 계산기로 되돌리기
                      </button>
                    )}
                    {isAdmin && (
                      <button
                        onClick={() => {
                          setDeleteModal({ visible: true, record: rec });
                          setContextMenu({ visible: false, x: 0, y: 0, record: null });
                        }}
                        style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--danger)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        🗑️ 삭제
                      </button>
                    )}
                  </>
                );
              }

              // For pending records
              const prevStageBoss = bossBattleStatuses.find(rs =>
                rs.global_raid_bosses.boss_number === bStatus.global_raid_bosses.boss_number &&
                rs.stage_level === bStatus.stage_level - 1
              );
              const canApplyRealDamage = !prevStageBoss || prevStageBoss.is_cleared;

              return (
                <>
                  {rec.is_in_calc && canApplyRealDamage && (
                    <button
                      onClick={() => {
                        if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
                        setApplyDamageModal({ visible: true, record: rec });
                        setContextMenu({ visible: false, x: 0, y: 0, record: null });
                      }}
                      style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--text-strong)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      💥 실전 타수로 적용
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      onClick={async () => {
                        if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
                        const newIsInCalc = !rec.is_in_calc;
                        if (newIsInCalc) {
                          const hits = completedCountByIdentity[identityKey(rec)] || 0;
                          if (hits >= MAX_HITS_PER_SEASON) {
                            alert('이미 3타수를 모두 소모한 유저는 계산기에 기록을 추가할 수 없습니다.');
                            setContextMenu({ visible: false, x: 0, y: 0, record: null });
                            return;
                          }

                          const usedNikkes = usedNikkesByUserId[identityKey(rec)] || new Set();
                          const squad = [rec.slot_1_nikke_id, rec.slot_2_nikke_id, rec.slot_3_nikke_id, rec.slot_4_nikke_id, rec.slot_5_nikke_id].filter(Boolean);
                          if (squad.some(nid => usedNikkes.has(nid))) {
                            alert('이미 사용된 니케가 포함되어 있어 계산기에 추가할 수 없습니다.');
                            setContextMenu({ visible: false, x: 0, y: 0, record: null });
                            return;
                          }
                        }
                        try {
                          const newBossStatusId = newIsInCalc ? bStatus.id : rec.boss_status_id;
                          setMockBattles(prev => prev.map(m => m.id === rec.id ? { ...m, is_in_calc: newIsInCalc, boss_status_id: newBossStatusId } : m));
                          if (demo.isDemo) {
                            demo.updateMockBattle(rec.id, { is_in_calc: newIsInCalc, boss_status_id: newBossStatusId });
                          } else {
                            await supabase.from('mock_battles').update({ is_in_calc: newIsInCalc, boss_status_id: newBossStatusId }).eq('id', rec.id);
                          }
                        } catch (err) {
                          setMockBattles(prev => prev.map(m => m.id === rec.id ? { ...m, is_in_calc: rec.is_in_calc, boss_status_id: rec.boss_status_id } : m));
                        }
                        setContextMenu({ visible: false, x: 0, y: 0, record: null });
                      }}
                      style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--text-strong)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      🏃 {rec.is_in_calc ? '대기열로 이동' : '계산기로 이동'}
                    </button>
                  )}
                  {(isAdmin || rec.user_id === user?.id) && (
                    <button
                      onClick={() => {
                        setDeleteModal({ visible: true, record: rec });
                        setContextMenu({ visible: false, x: 0, y: 0, record: null });
                      }}
                      style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--danger)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                      onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                      onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      🗑️ 삭제
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* Delete Modal */}
      <DeleteMockModal
        visible={deleteModal.visible}
        onExcludeFromBoard={async () => {
          try {
            if (demo.isDemo) {
              demo.updateMockBattle(deleteModal.record.id, { is_queued: false, is_in_calc: false });
            } else {
              await supabase.from('mock_battles').update({ is_queued: false, is_in_calc: false }).eq('id', deleteModal.record.id);
            }
            setDeleteModal({ visible: false, record: null });
          } catch (err) { console.error(err); }
        }}
        onFullDelete={async () => {
          try {
            if (demo.isDemo) {
              demo.deleteMockBattle(deleteModal.record.id);
            } else {
              await supabase.from('mock_battles').delete().eq('id', deleteModal.record.id);
            }
            setDeleteModal({ visible: false, record: null });
          } catch (err) { console.error(err); }
        }}
        onCancel={() => setDeleteModal({ visible: false, record: null })}
      />

      {/* Apply Real Damage Modal */}
      {applyDamageModal.visible && (() => {
        const applyBossStatus = bossBattleStatuses.find(rs => rs.id === applyDamageModal.record.boss_status_id);
        // 5번 보스의 최종 단계는 무한 보스(체력 누적, 막타 없음)
        const applyIsInfinite = !!applyBossStatus
          && applyBossStatus.global_raid_bosses.boss_number === 5
          && applyBossStatus.stage_level === maxStageBoss5;
        return (
          <ApplyRealDamageModal
            isOpen={true}
            onClose={() => setApplyDamageModal({ visible: false, record: null })}
            mockBattle={applyDamageModal.record}
            bossStatus={applyBossStatus}
            isInfinite={applyIsInfinite}
            onApplyComplete={async () => {
              setApplyDamageModal({ visible: false, record: null });
              await fetchBossBattleData();
            }}
          />
        );
      })()}

      {/* 보스 정보 모달 (보스 이름 클릭) */}
      {bossInfoNum !== null && (
        <BossInfoModal
          boss={bossBattleStatuses.find(rs => rs.global_raid_bosses.boss_number === bossInfoNum)?.global_raid_bosses}
          memo={bossMemos.find(m => m.boss_number === bossInfoNum)?.memo}
          squads={recommendedSquads.filter(s => s.boss_number === bossInfoNum)}
          getMemberName={getMemberName}
          isNarrow={isNarrow}
          onClose={() => setBossInfoNum(null)}
        />
      )}
    </div>
  );
}

