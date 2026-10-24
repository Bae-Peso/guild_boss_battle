import React, { useState, useEffect, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { onGuildChanges } from "../../lib/realtime";
import { useDemo } from "../../demo/DemoContext";
import NikkeSelectorModal from "./NikkeSelectorModal";
import MockBattleForm from "./MockBattleForm";
import MockBattleUploadModal from "./MockBattleUploadModal";
import ApplyRealDamageModal from "./ApplyRealDamageModal";
import DeleteMockModal from "./DeleteMockModal";
import NikkeAvatar from "../../components/NikkeAvatar";
import BossImage from "../../components/BossImage";
import SquadMemoBadge from "./SquadMemoBadge";
import { SortableTh } from "../../components/TableControls";
import { useLocation } from "react-router-dom";
import { usePreferences } from "../../hooks/usePreferences";
import { useBossBattleSeasons } from "../../hooks/useBossBattleSeasons";
import { useGameData } from "../../contexts/GameDataContext";
import { makeIdentity } from "../../lib/identity";
import { buildManualTargets } from "../../lib/manualTargets";
import { fetchPrevSeasonSynchro } from "../../lib/prevSynchro";
import "./MockBattleDashboard.css";

// 속성 아이콘 이모지 폴백 (game_icons 미등록 시). 지휘 현황판과 같은 규칙.
const ELEMENT_ICON = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };

function MockBattleDashboard() {
  const { guild, user, allMembers, isAdmin, synchroLevel, setSynchroLevel, leftCollapsed, rightCollapsed, isNarrow } = useOutletContext();
  const demo = useDemo();
  const location = useLocation();
  const { seasons, selectedSeason, setSelectedSeason, seasonsReady } = useBossBattleSeasons(guild?.id);
  const { nikkes: allNikkes, gameIcons } = useGameData();
  const elementIconUrl = (element) =>
    gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;
  const [isLockedSeason, setIsLockedSeason] = useState(false);
  const [bossBattleStatuses, setBossBattleStatuses] = useState([]);
  const [mockBattles, setMockBattles] = useState([]);
  const [recommendedSquads, setRecommendedSquads] = useState([]);
  const [bossMemos, setBossMemos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBossNum, setSelectedBossNum] = useState(null);

  // Sort state
  // 기록 표 정렬(컬럼 헤더 클릭). 기본은 딜량 내림차순.
  const [sortField, setSortField] = useState('damage'); // 'damage' | 'synchro' | 'nickname'
  const [sortDir, setSortDir] = useState('desc');
  const handleMbSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'nickname' ? 'asc' : 'desc');
    }
  };
  const mbSort = { sortField, sortDir, handleSort: handleMbSort };
  const { hpMode, setHpMode, showSquad, setShowSquad } = usePreferences();
  const [showCalcMocksInPool, setShowCalcMocksInPool] = useState(false);
  // 기록 표에서 로그인 유저 본인의 기록만 필터링(관리자 대리 작성 기록 제외).
  const [showOnlyMine, setShowOnlyMine] = useState(false);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, record: null });

  // Delete Modal State
  const [deleteModal, setDeleteModal] = useState({ visible: false, record: null });

  // 타수 집계용 식별: 닉네임+싱크로가 같으면 본인 작성/관리자 수기 기록을 동일 인물로 합친다.
  const identity = useMemo(() => makeIdentity(allMembers), [allMembers]);
  const identityKey = identity.identityKey;

  // Parse URL to set selectedBossNum initially
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const boss = parseInt(params.get('bossNum'), 10);
    if (boss >= 1 && boss <= 5) {
      setSelectedBossNum(boss);
    }
  }, [location.search]);

  // Admin Recommend Squad form state
  const [isEditingSquad, setIsEditingSquad] = useState(false);
  const [editingSquadId, setEditingSquadId] = useState(null);
  const [squadNameInput, setSquadNameInput] = useState('');
  const [squadMemoInput, setSquadMemoInput] = useState('');
  const [adminSquadNikkes, setAdminSquadNikkes] = useState([null, null, null, null, null]);

  // Edit Mock Battle Modal State
  const [editMockModal, setEditMockModal] = useState({ visible: false, record: null });
  const [applyDamageModal, setApplyDamageModal] = useState({ visible: false, record: null });
  const [memoModal, setMemoModal] = useState({ visible: false, currentMemo: '' });
  const [hoveredMemo, setHoveredMemo] = useState({ visible: false, text: '', x: 0, y: 0, isPinned: false, id: null });
  // 모바일: 추천덱 메모를 중앙 모달로 표시 (hover/pin 대신)
  const [memoView, setMemoView] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newRecordInitialData, setNewRecordInitialData] = useState(null);

  const squadToNikkeArray = (squad) => {
    const ids = [squad.slot_1_nikke_id, squad.slot_2_nikke_id, squad.slot_3_nikke_id, squad.slot_4_nikke_id, squad.slot_5_nikke_id];
    return ids.map(id => (id ? (allNikkes || []).find(n => n.id === id) || null : null));
  };

  const bossRecommendedSquads = useMemo(
    () => recommendedSquads.filter(s => s.boss_number === selectedBossNum),
    [recommendedSquads, selectedBossNum]
  );

  // 보스 배너/정보 카드뿐 아니라 니케 선택 모달(사용 빈도 집계 기준)에서도 쓰므로
  // renderSelectedBossContent 안이 아니라 컴포넌트 스코프에 둔다.
  const selectedBossInfo = useMemo(
    () => bossBattleStatuses.find(rs => rs.global_raid_bosses.boss_number === selectedBossNum)?.global_raid_bosses || null,
    [bossBattleStatuses, selectedBossNum]
  );

  // 수기 입력에서 고를 수 있는 대상: 길드 로스터 + 이번 시즌에 이미 적힌 수기 닉네임.
  const manualTargets = useMemo(() => buildManualTargets(allMembers, mockBattles), [allMembers, mockBattles]);

  const usedNikkesByIdentityKey = useMemo(() => {
    const map = {};
    mockBattles.forEach(mb => {
      if (mb.status === 'completed' || mb.is_in_calc) {
        const key = identityKey(mb);
        if (!map[key]) map[key] = new Set();
        if (mb.slot_1_nikke_id) map[key].add(mb.slot_1_nikke_id);
        if (mb.slot_2_nikke_id) map[key].add(mb.slot_2_nikke_id);
        if (mb.slot_3_nikke_id) map[key].add(mb.slot_3_nikke_id);
        if (mb.slot_4_nikke_id) map[key].add(mb.slot_4_nikke_id);
        if (mb.slot_5_nikke_id) map[key].add(mb.slot_5_nikke_id);
      }
    });
    return map;
  }, [mockBattles, identityKey]);

  const [isNikkeModalOpen, setIsNikkeModalOpen] = useState(false);
  const [selectingSlotIndex, setSelectingSlotIndex] = useState(null);

  // 시즌이 없으면 로딩 종료 (시즌 없을 때 무한 로딩되던 동작 방지)
  useEffect(() => {
    if (seasonsReady && seasons.length === 0) setLoading(false);
  }, [seasonsReady, seasons.length]);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      if (!selectedSeason || !guild) return;

      // 체험 모드: 목업 스토어에서 구성
      if (demo.isDemo) {
        const d = demo.data;
        if (!d) return;
        const statuses = d.bossBattleStatuses.filter(s => s.global_raid_bosses.season_name === selectedSeason);
        const statusIds = statuses.map(s => s.id);
        setBossBattleStatuses(statuses);
        setMockBattles(d.mockBattles.filter(b => statusIds.includes(b.boss_status_id)));
        setRecommendedSquads(d.recommendedSquads.filter(s => s.season_name === selectedSeason));
        setBossMemos(d.bossMemos.filter(m => m.season_name === selectedSeason));
        setIsLockedSeason(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Fetch Boss Statuses for selected season
        const { data: statuses, error: statusErr } = await supabase
          .from('union_raid_status')
          .select(`
            id, stage_level, current_hp, is_cleared,
            global_raid_bosses!inner ( id, boss_number, name, element, boss_grade, season_name, image_url, image_alt )
          `)
          .eq('union_id', guild.id)
          .eq('global_raid_bosses.season_name', selectedSeason);

        if (statusErr) throw statusErr;

        // Fetch Mock Battles for the current season's statuses
        const statusIds = statuses ? statuses.map(s => s.id) : [];
        let battles = [];
        if (statusIds.length > 0) {
          const { data: bData, error: battleErr } = await supabase
            .from('mock_battles')
            .select('*')
            .eq('union_id', guild.id)
            .in('boss_status_id', statusIds)
            .order('id', { ascending: true });
          if (battleErr) throw battleErr;
          battles = bData;
        }

        // Fetch Recommended Squads
        const { data: squads, error: squadErr } = await supabase
          .from('recommended_squads')
          .select('*')
          .eq('union_id', guild.id)
          .eq('season_name', selectedSeason);

        if (squadErr) throw squadErr;
        setRecommendedSquads(squads || []);

        // Fetch Boss Memos
        const { data: memos, error: memoErr } = await supabase
          .from('union_boss_memos')
          .select('*')
          .eq('union_id', guild.id)
          .eq('season_name', selectedSeason);

        if (memoErr) throw memoErr;
        setBossMemos(memos || []);

        // Fetch lock status
        const { data: lockData } = await supabase
          .from('union_raid_season_settings')
          .select('is_locked')
          .eq('union_id', guild.id)
          .eq('season_name', selectedSeason)
          .maybeSingle();

        if (isMounted) {
          setIsLockedSeason(lockData?.is_locked || false);
          setBossBattleStatuses(statuses || []);
          setMockBattles(battles || []);
          setLoading(false);
        }
      } catch (err) {
        console.error("Fetch error:", err);
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    // 체험 모드: realtime 구독 없이 스토어에서 재조회 (demo.rev 변경 시 effect 재실행)
    if (demo.isDemo) {
      return () => { isMounted = false; };
    }

    // Realtime Subscriptions (고유 채널명으로 재구독 충돌 방지)
    const channel = supabase.channel(`mock_battle_dashboard_changes_${Date.now()}`);
    onGuildChanges(channel, 'mock_battles', guild.id, payload => {
      if (payload.new && payload.new.union_id && payload.new.union_id !== guild.id) return;
      if (payload.eventType === 'INSERT') {
        setMockBattles(prev => {
          if (prev.some(mb => mb.id === payload.new.id)) return prev;
          return [...prev, payload.new];
        });
      } else if (payload.eventType === 'UPDATE') {
        setMockBattles(prev => prev.map(mb => mb.id === payload.new.id ? { ...mb, ...payload.new } : mb));
      } else if (payload.eventType === 'DELETE') {
        setMockBattles(prev => prev.filter(mb => mb.id !== payload.old.id));
      }
    });
    onGuildChanges(channel, 'union_boss_memos', guild.id, payload => {
      if (payload.new && payload.new.union_id && payload.new.union_id !== guild.id) return;
      if (payload.eventType === 'INSERT') {
        setBossMemos(prev => {
          if (prev.some(m => m.id === payload.new.id)) return prev;
          return [...prev, payload.new];
        });
      } else if (payload.eventType === 'UPDATE') {
        setBossMemos(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
      } else if (payload.eventType === 'DELETE') {
        setBossMemos(prev => prev.filter(m => m.id !== payload.old.id));
      }
    });
    onGuildChanges(channel, 'recommended_squads', guild.id, async payload => {
      if (payload.new && payload.new.union_id && payload.new.union_id !== guild.id) return;

      if (payload.eventType === 'INSERT') {
        setRecommendedSquads(prev => {
          if (prev.some(s => s.id === payload.new.id)) return prev;
          return [...prev, payload.new];
        });
      } else if (payload.eventType === 'UPDATE') {
        setRecommendedSquads(prev => prev.map(s => s.id === payload.new.id ? { ...s, ...payload.new } : s));
      } else if (payload.eventType === 'DELETE') {
        setRecommendedSquads(prev => prev.filter(s => s.id !== payload.old.id));
      }
    });
    channel.subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [guild, selectedSeason, demo.isDemo, demo.rev]);

  const formatHp = (hp) => {
    if (hpMode === 'detail') {
      return Number(hp).toLocaleString();
    }
    return (hp / 100000000).toFixed(1) + '억';
  };

  const getMemberName = (userId) => {
    const m = allMembers.find(x => x.user_id === userId);
    return m ? m.in_game_name : '알 수 없음';
  };

  if (loading && seasons.length === 0) {
    return <div style={{ padding: '2rem', color: 'var(--text-strong)' }}>데이터를 불러오는 중...</div>;
  }

  // 지난 시즌 싱크로 조회 (레벨 미갱신 경고용). 체험 모드에서는 건너뛴다.
  const checkPrevSynchro = async ({ isManualTarget, manualNickname }) => {
    if (demo.isDemo || !guild?.id || !selectedSeason) return null;
    const memberKey = isManualTarget
      ? (manualNickname ? `manual:${manualNickname}` : null)
      : (user?.id ? `user:${user.id}` : null);
    if (!memberKey) return null;
    return fetchPrevSeasonSynchro(guild.id, selectedSeason, memberKey);
  };

  const handleAddMockBattle = async (formData) => {
    if (!selectedBossNum) return;

    // Find highest stage status ID for the selected boss
    const bossStatuses = bossBattleStatuses.filter(rs => rs.global_raid_bosses.boss_number === selectedBossNum);
    if (bossStatuses.length === 0) return alert('보스 상태 정보를 찾을 수 없습니다.');
    const targetStatus = bossStatuses.reduce((prev, current) => (prev.stage_level > current.stage_level) ? prev : current);

    const { damage, synchroLevel: inputSynchro, nikkes, memo, isManualTarget, manualNickname } = formData;

    try {
      const payload = {
        union_id: guild.id,
        user_id: isManualTarget ? null : user.id,
        boss_status_id: targetStatus.id,
        expected_damage: damage,
        status: 'pending',
        is_queued: false,
        is_admin_written: isManualTarget,
        manual_nickname: manualNickname,
        memo: memo,
        synchro_level: inputSynchro,
        slot_1_nikke_id: nikkes[0]?.id || null,
        slot_2_nikke_id: nikkes[1]?.id || null,
        slot_3_nikke_id: nikkes[2]?.id || null,
        slot_4_nikke_id: nikkes[3]?.id || null,
        slot_5_nikke_id: nikkes[4]?.id || null
      };

      let newRow, error;
      if (demo.isDemo) {
        newRow = demo.insertMockBattle(payload);
      } else {
        ({ data: newRow, error } = await supabase
          .from('mock_battles')
          .insert({ ...payload, user_id: user.id })
          .select()
          .single());
      }

      if (error) throw error;

      if (!isManualTarget && inputSynchro && inputSynchro !== synchroLevel) {
        setSynchroLevel(inputSynchro);
        if (demo.isDemo) demo.setSynchro(inputSynchro);
        else supabase.from('users').update({ synchro_level: inputSynchro }).eq('id', user.id).then();
      }

      alert('모의전이 등록되었습니다.');
      // Update state locally so we don't need a page reload. Realtime will also fire, 
      // but React will handle duplicate keys gracefully or we can just let realtime do it.
      setMockBattles(prev => {
        if (!prev.find(b => b.id === newRow.id)) {
          return [...prev, newRow];
        }
        return prev;
      });

    } catch (err) {
      console.error(err);
      alert('등록 실패: ' + err.message);
    }
  };

  const handleSaveRecommendedSquad = async () => {
    // 덱 이름은 선택사항
    if (!selectedBossNum) return;
    // 최소 1명의 니케가 구성되어야 함
    const hasNikke = adminSquadNikkes.some(n => n !== null);
    if (!hasNikke) return alert('최소 1명의 니케를 구성해주세요.');

    try {
      const payload = {
        union_id: guild.id,
        season_name: selectedSeason,
        boss_number: selectedBossNum,
        name: squadNameInput.trim() || '이름 없는 덱',
        memo: squadMemoInput.trim() || null,
        slot_1_nikke_id: adminSquadNikkes[0]?.id || null,
        slot_2_nikke_id: adminSquadNikkes[1]?.id || null,
        slot_3_nikke_id: adminSquadNikkes[2]?.id || null,
        slot_4_nikke_id: adminSquadNikkes[3]?.id || null,
        slot_5_nikke_id: adminSquadNikkes[4]?.id || null,
        created_by: user.id
      };

      if (demo.isDemo) {
        const row = demo.upsertRecommendedSquad(payload, editingSquadId);
        setRecommendedSquads(prev => (editingSquadId
          ? prev.map(s => s.id === editingSquadId ? row : s)
          : (prev.some(s => s.id === row.id) ? prev : [...prev, row])));
      } else if (editingSquadId) {
        const { data, error } = await supabase.from('recommended_squads').update(payload).eq('id', editingSquadId).select().single();
        if (error) throw error;
        setRecommendedSquads(prev => prev.map(s => s.id === editingSquadId ? data : s));
      } else {
        const { data, error } = await supabase.from('recommended_squads').insert([payload]).select().single();
        if (error) throw error;
        setRecommendedSquads(prev => {
          if (prev.some(s => s.id === data.id)) return prev;
          return [...prev, data];
        });
      }

      alert('추천 덱이 저장되었습니다.');
      setIsEditingSquad(false);
      setEditingSquadId(null);
    } catch (err) {
      console.error(err);
      alert('추천 덱 저장 실패: ' + err.message);
    }
  };

  const handleDeleteSquad = async (id) => {
    if (!confirm('이 덱을 삭제하시겠습니까?')) return;
    try {
      if (demo.isDemo) demo.deleteRecommendedSquad(id);
      else await supabase.from('recommended_squads').delete().eq('id', id);
      setRecommendedSquads(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveBossMemo = async (newMemo) => {
    try {
      if (demo.isDemo) {
        const row = demo.upsertBossMemo({ boss_number: selectedBossNum, season_name: selectedSeason, memo: newMemo });
        setBossMemos(prev => (prev.some(m => m.id === row.id) ? prev.map(m => m.id === row.id ? row : m) : [...prev, row]));
        return;
      }
      const existing = bossMemos.find(m => m.boss_number === selectedBossNum);
      if (existing) {
        await supabase.from('union_boss_memos').update({ memo: newMemo }).eq('id', existing.id);
        setBossMemos(prev => prev.map(m => m.id === existing.id ? { ...m, memo: newMemo } : m));
      } else {
        const { data } = await supabase.from('union_boss_memos').insert([{
          union_id: guild.id,
          season_name: selectedSeason,
          boss_number: selectedBossNum,
          memo: newMemo
        }]).select().single();
        if (data) setBossMemos(prev => [...prev, data]);
      }
    } catch (err) {
      console.error(err);
      alert('메모 저장 실패');
    }
  };

  const openNikkeSelector = (idx) => {
    setSelectingSlotIndex(idx);
    setIsNikkeModalOpen(true);
  };

  const handleNikkeConfirm = (newNikkes) => {
    setAdminSquadNikkes(newNikkes);
    setIsNikkeModalOpen(false);
  };

  const handleJumpToLatest = () => {
    if (seasons.length > 0) setSelectedSeason(seasons[0].name);
  };

  const handleLoadRecommendedSquadForNewRecord = (squad) => {
    setNewRecordInitialData({ nikkes: squadToNikkeArray(squad) });
  };

  const renderTopControls = () => (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: isNarrow ? 'wrap' : undefined, gap: isNarrow ? '8px' : '15px', padding: isNarrow ? '14px 16px' : '20px', paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined, paddingRight: rightCollapsed ? 'var(--panel-collapse-inset)' : undefined, borderBottom: '1px solid var(--border-1)' }}>
      <div style={{ fontWeight: 'bold', color: 'var(--accent-green)', fontSize: isNarrow ? '1.05rem' : '1.2rem' }}>
        🎯 모의전 기록
      </div>
      <select
        value={selectedSeason}
        onChange={(e) => setSelectedSeason(e.target.value)}
        style={{ padding: '6px', borderRadius: '4px', background: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-1)' }}
      >
        {seasons.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
      </select>
      <button
        onClick={handleJumpToLatest}
        style={{ padding: '6px 12px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
      >
        현재 시즌
      </button>

      {isAdmin && (
        <label style={{ fontSize: '0.85rem', color: 'var(--text-strong)', marginLeft: '10px' }}>
          <input
            type="checkbox"
            checked={showCalcMocksInPool}
            onChange={(e) => setShowCalcMocksInPool(e.target.checked)}
          /> 현황판(계산기)에 올린 타수 포함 보기
        </label>
      )}

      <button
        onClick={() => setHpMode(hpMode === 'simple' ? 'detail' : 'simple')}
        style={{ marginLeft: isNarrow ? 0 : 'auto', fontSize: '0.85rem', padding: '6px 12px', background: hpMode === 'simple' ? '#3b82f6' : '#ef4444', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        {hpMode === 'simple' ? '간이 모드' : '상세 모드'}
      </button>
    </div>
  );

  const renderSelectedBossContent = () => {
    if (!selectedBossNum) return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>보스를 선택해주세요.</div>;

    const bossInfo = selectedBossInfo;
    const bossBattles = mockBattles.filter(mb => {
      const rs = bossBattleStatuses.find(r => r.id === mb.boss_status_id);
      if (!rs || rs.global_raid_bosses.boss_number !== selectedBossNum) return false;
      if (mb.status === 'completed') return false; // 만약 실제 타수로 사용했다면 안 보이게끔
      if (mb.is_in_calc && !showCalcMocksInPool) return false;
      // 나의 기록만 표시: 로그인 유저 본인이 직접 작성한 기록만(관리자 대리 작성 제외).
      if (showOnlyMine && (mb.is_admin_written || mb.user_id !== user.id)) return false;
      return true;
    });

    // Sorting (컬럼 헤더 클릭 기준)
    // 닉네임/레벨로 정렬하더라도 1차 정렬값이 같을 때는 대미지 내림차순으로 2차 정렬한다.
    // (닉네임별로 묶었을 때 대미지가 뒤죽박죽 보이던 문제 방지)
    bossBattles.sort((a, b) => {
      let cmp;
      if (sortField === 'damage') {
        cmp = (a.expected_damage || 0) - (b.expected_damage || 0);
      } else if (sortField === 'synchro') {
        cmp = (a.synchro_level || 0) - (b.synchro_level || 0);
      } else {
        const nameA = a.is_admin_written ? a.manual_nickname : getMemberName(a.user_id);
        const nameB = b.is_admin_written ? b.manual_nickname : getMemberName(b.user_id);
        cmp = (nameA || '').localeCompare(nameB || '');
      }
      if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
      // 1차 정렬값이 같으면(같은 닉네임/레벨) 대미지 내림차순
      return (b.expected_damage || 0) - (a.expected_damage || 0);
    });

    const squads = recommendedSquads.filter(s => s.boss_number === selectedBossNum);
    const memoRecord = bossMemos.find(m => m.boss_number === selectedBossNum);

    return (
      <div style={isNarrow
        ? { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', minHeight: 0 }
        : { display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={isNarrow
          ? { borderBottom: '1px solid var(--border-1)', padding: '16px' }
          : { flex: 1, borderRight: '1px solid var(--border-1)', padding: '20px', overflowY: 'auto' }}>
          {/* 보스 배너. 아래 '보스 정보' 카드와 같은 폭(= 이 컬럼 전체)을 쓰고, 이미지는 cover로
              채워 상하를 잘라낸다. 모바일은 세로 공간이 귀해 더 납작하게 자른다. */}
          <div style={{
            width: '100%', height: isNarrow ? '140px' : '240px',
            marginBottom: '12px', borderRadius: '8px', overflow: 'hidden',
            backgroundColor: 'var(--surface-2)',
          }}>
            <BossImage
              url={bossInfo?.image_url}
              alt={bossInfo?.image_alt}
              element={bossInfo?.element}
              size={isNarrow ? 140 : 240}
              fit="cover"
              fade={0.1}
              fallbackFit="contain"
              fallbackSize={isNarrow ? 72 : 96}
              style={{ width: '100%', height: '100%', borderRadius: 0 }}
            />
          </div>
          <h3 style={{ fontSize: isNarrow ? '1.3rem' : '1.75rem', margin: '0 0 10px' }}>{bossInfo?.name} 정보</h3>
          <div style={{ backgroundColor: 'var(--surface-2)', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
            <p><strong>등급:</strong> {bossInfo?.boss_grade}</p>
            <p>
              <strong>약점 속성:</strong>{' '}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, verticalAlign: 'middle' }}>
                {bossInfo?.element}
                {elementIconUrl(bossInfo?.element)
                  ? <img src={elementIconUrl(bossInfo?.element)} alt={bossInfo?.element} style={{ width: '1.1em', height: '1.1em', objectFit: 'contain' }} />
                  : <span>{ELEMENT_ICON[bossInfo?.element] || ''}</span>}
              </span>
            </p>
          </div>

          <h3>보스 메모</h3>
          <div style={{ backgroundColor: 'var(--surface-2)', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
            <p style={{ whiteSpace: 'pre-wrap', color: memoRecord?.memo ? 'var(--text-strong)' : 'var(--text-dim)' }}>
              {memoRecord?.memo || '등록된 메모가 없습니다.'}
            </p>
            {isAdmin && (
              <button
                onClick={() => {
                  setMemoModal({ visible: true, currentMemo: memoRecord?.memo || '' });
                }}
                style={{ marginTop: '10px', padding: '6px 10px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                메모 수정
              </button>
            )}
          </div>

          <h3>관리자 추천 덱</h3>
          {isEditingSquad ? (
            <div style={{ backgroundColor: 'var(--surface-2)', padding: '15px', borderRadius: '8px' }}>
              <input
                type="text"
                value={squadNameInput}
                onChange={e => setSquadNameInput(e.target.value)}
                placeholder="덱 이름 (선택사항, 기본: 이름 없는 덱)"
                style={{ width: '100%', padding: '8px', marginBottom: '10px', background: 'var(--surface-0)', color: 'var(--text-strong)', border: '1px solid var(--border-1)', borderRadius: '4px' }}
              />
              <textarea
                value={squadMemoInput}
                onChange={e => setSquadMemoInput(e.target.value)}
                placeholder="덱 메모 (마우스 오버 시 표시)"
                style={{ width: '100%', padding: '8px', marginBottom: '10px', background: 'var(--surface-0)', color: 'var(--text-strong)', border: '1px solid var(--border-1)', borderRadius: '4px', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: '5px', marginBottom: '10px' }}>
                {[0, 1, 2, 3, 4].map(idx => (
                  <div
                    key={idx}
                    onClick={() => openNikkeSelector(idx)}
                    style={{ width: '50px', height: '50px', backgroundColor: 'var(--surface-1)', borderRadius: '4px', border: '1px dashed var(--border-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-dim)', cursor: 'pointer', overflow: 'hidden' }}
                  >
                    {adminSquadNikkes[idx] ? (
                      <NikkeAvatar nikkeId={adminSquadNikkes[idx].id} size={50} />
                    ) : '+'}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={handleSaveRecommendedSquad} style={{ flex: 1, padding: '6px', background: 'var(--accent-green)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>저장</button>
                <button onClick={() => { setIsEditingSquad(false); setEditingSquadId(null); }} style={{ flex: 1, padding: '6px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
              </div>
            </div>
          ) : (
            <>
              {squads.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {squads.map(s => (
                    <div key={s.id} style={{ backgroundColor: 'var(--surface-2)', padding: '15px', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                        <div style={{ margin: 0, wordBreak: 'break-all', flex: 1, paddingRight: '10px' }}>
                          <span style={{ fontWeight: 'bold' }}>{s.name}</span>
                          {s.created_by && (
                            <span style={{ marginLeft: '6px', fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 'normal', whiteSpace: 'nowrap' }}>
                              {getMemberName(s.created_by)}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                          {s.memo && (
                            <div
                              style={{ cursor: isNarrow ? 'pointer' : 'help', display: 'inline-block' }}
                              onMouseEnter={isNarrow ? undefined : (e) => {
                                if (hoveredMemo.isPinned) return; // Prevent hover if a memo is pinned
                                const rect = e.currentTarget.getBoundingClientRect();
                                setHoveredMemo({ visible: true, text: s.memo, x: rect.right + 10, y: rect.top, isPinned: false, id: s.id });
                              }}
                              onMouseLeave={isNarrow ? undefined : () => {
                                if (hoveredMemo.isPinned) return;
                                setHoveredMemo({ visible: false, text: '', x: 0, y: 0, isPinned: false, id: null });
                              }}
                              onClick={(e) => {
                                // 모바일: hover가 안 되므로 중앙 모달로 표시
                                if (isNarrow) { setMemoView(s.memo); return; }
                                if (hoveredMemo.id === s.id && hoveredMemo.isPinned) {
                                  // Unpin if already pinned
                                  setHoveredMemo({ ...hoveredMemo, isPinned: false });
                                } else {
                                  // Pin it
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredMemo({ visible: true, text: s.memo, x: rect.right + 10, y: rect.top, isPinned: true, id: s.id });
                                }
                              }}
                            >
                              📝
                            </div>
                          )}
                          {isAdmin && (
                            <div style={{ display: 'flex', gap: '5px' }}>
                              <button
                                onClick={() => {
                                  setSquadNameInput(s.name);
                                  setSquadMemoInput(s.memo || '');
                                  setEditingSquadId(s.id);
                                  setAdminSquadNikkes(squadToNikkeArray(s));
                                  setIsEditingSquad(true);
                                }}
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' }}
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => handleDeleteSquad(s.id)}
                                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.9rem' }}
                              >
                                🗑️
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '5px' }}>
                        {[s.slot_1_nikke_id, s.slot_2_nikke_id, s.slot_3_nikke_id, s.slot_4_nikke_id, s.slot_5_nikke_id].map((id, idx) => (
                          <div key={idx} style={{ width: '50px', height: '50px', backgroundColor: 'var(--surface-1)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', color: 'var(--text-dim)', overflow: 'hidden' }}>
                            {id ? <NikkeAvatar nikkeId={id} size={50} /> : '비어있음'}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>등록된 추천 덱이 없습니다.</div>
              )}

              {isAdmin && (
                <button
                  onClick={() => {
                    setSquadNameInput('');
                    setSquadMemoInput('');
                    setEditingSquadId(null);
                    setAdminSquadNikkes([null, null, null, null, null]);
                    setIsEditingSquad(true);
                  }}
                  style={{ marginTop: '10px', padding: '8px', background: 'var(--accent-blurple)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', width: '100%' }}
                >
                  + 추천 덱 등록하기
                </button>
              )}
            </>
          )}
        </div>

        <div style={isNarrow
          ? { padding: '16px', display: 'flex', flexDirection: 'column' }
          : { flex: 2, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0 }}>길드원 모의전 기록</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: isNarrow ? '8px' : '15px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowOnlyMine(v => !v)}
                style={{ background: showOnlyMine ? 'var(--accent-green)' : 'transparent', border: showOnlyMine ? '1px solid var(--accent-green)' : '1px solid var(--border-3)', color: showOnlyMine ? 'var(--text-inverse)' : 'var(--text-soft)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: showOnlyMine ? 'bold' : 'normal' }}
              >
                {showOnlyMine ? '✓ 나의 기록만' : '나의 기록만 표시'}
              </button>
              <button
                onClick={() => setShowSquad(!showSquad)}
                style={{ background: 'transparent', border: '1px solid var(--border-3)', color: 'var(--text-soft)', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                스쿼드 {showSquad ? '숨기기' : '표시'}
              </button>
              {!isNarrow && <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>표 머리글을 눌러 정렬</span>}
            </div>
          </div>

          <div style={isNarrow
            ? { backgroundColor: 'var(--surface-2)', borderRadius: '8px', padding: '12px', marginBottom: '15px', overflowX: 'auto' }
            : { flex: 1, backgroundColor: 'var(--surface-2)', borderRadius: '8px', padding: '15px', marginBottom: '20px', overflowY: 'auto' }}>
            {bossBattles.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>등록된 모의전 기록이 없습니다.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-1)', textAlign: 'left', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                    <SortableTh field="nickname" sort={mbSort} style={{ padding: '10px 5px' }}>닉네임</SortableTh>
                    <SortableTh field="synchro" sort={mbSort} style={{ padding: '10px 5px', width: '60px' }}>레벨</SortableTh>
                    <th style={{ padding: '10px 5px' }}>스쿼드</th>
                    <th style={{ padding: '10px 5px', textAlign: 'center', width: '48px' }}>메모</th>
                    <SortableTh field="damage" sort={mbSort} style={{ padding: '10px 5px', textAlign: 'right' }}>대미지</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {bossBattles.map(mb => {
                    const isUsedNikke = (nid) => usedNikkesByIdentityKey[identityKey(mb)]?.has(nid);
                    return (
                      <tr
                        key={mb.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!isAdmin && mb.user_id !== user.id) return;
                          setContextMenu({ visible: true, x: e.pageX, y: e.pageY, record: mb });
                        }}
                        style={{
                          borderBottom: '1px solid var(--border-1)',
                          backgroundColor: mb.is_in_calc ? 'rgba(255, 193, 7, 0.1)' : 'transparent',
                          cursor: (isAdmin || mb.user_id === user.id) ? 'context-menu' : 'default'
                        }}
                      >
                        <td style={{ padding: '10px 5px' }}>
                          {mb.is_in_calc && (
                            <span style={{ color: 'var(--accent-amber)', marginRight: '5px', fontWeight: 'bold' }}>
                              ({bossBattleStatuses.find(r => r.id === mb.boss_status_id)?.stage_level}단계)
                            </span>
                          )}
                          {mb.is_admin_written ? (
                            <span style={{ color: 'var(--text-muted)' }}>* {mb.manual_nickname}</span>
                          ) : (
                            <span style={{ fontWeight: 'bold', color: 'var(--text-strong)' }}>{getMemberName(mb.user_id)}</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 5px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          Lv.{mb.synchro_level || '?'}
                        </td>
                        <td style={{ padding: '10px 5px' }}>
                          {showSquad ? (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              {[mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id, mb.slot_4_nikke_id, mb.slot_5_nikke_id].filter(Boolean).map((nid, i) => (
                                <NikkeAvatar
                                  key={i}
                                  nikkeId={nid}
                                  size={48}
                                  style={{ filter: isUsedNikke(nid) ? 'grayscale(100%) opacity(0.4)' : 'none' }}
                                />
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--border-3)', fontSize: '0.85rem' }}>스쿼드 가림</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 5px', textAlign: 'center' }}>
                          <SquadMemoBadge memo={mb.memo} isNarrow={isNarrow} />
                        </td>
                        <td style={{ padding: '10px 5px', textAlign: 'right', color: mb.is_in_calc ? 'var(--accent-amber)' : 'var(--accent-green)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                          {formatHp(mb.expected_damage)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <button
            onClick={() => { setNewRecordInitialData(null); setIsAddModalOpen(true); }}
            style={{ marginTop: '20px', padding: '12px', background: 'var(--accent-blurple)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            + 새 모의전 등록
          </button>
        </div>

        {memoModal.visible && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setMemoModal({ visible: false, currentMemo: '' })}>
            <div style={{ backgroundColor: 'var(--surface-2)', padding: '20px', borderRadius: '8px', width: '400px', maxWidth: '90%' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ marginTop: 0, color: 'var(--text-strong)' }}>보스 메모 수정</h3>
              <textarea
                value={memoModal.currentMemo}
                onChange={e => setMemoModal(prev => ({ ...prev, currentMemo: e.target.value }))}
                placeholder="메모를 입력하세요..."
                style={{ width: '100%', height: '150px', padding: '10px', backgroundColor: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-1)', borderRadius: '4px', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '15px' }}>
                <button onClick={() => setMemoModal({ visible: false, currentMemo: '' })} style={{ padding: '8px 16px', backgroundColor: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>취소</button>
                <button onClick={() => { handleSaveBossMemo(memoModal.currentMemo); setMemoModal({ visible: false, currentMemo: '' }); }} style={{ padding: '8px 16px', backgroundColor: 'var(--accent-green)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>저장</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--surface-3)', color: 'var(--text-strong)' }}>
      {renderTopControls()}
      {renderSelectedBossContent()}

      <NikkeSelectorModal
        isOpen={isNikkeModalOpen}
        onClose={() => setIsNikkeModalOpen(false)}
        initialSelected={adminSquadNikkes}
        activeSlotIndex={selectingSlotIndex}
        onConfirm={handleNikkeConfirm}
        bossName={selectedBossInfo?.name || null}
        bossElement={selectedBossInfo?.element || null}
      />

      {contextMenu.visible && (
        <>
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }} onClick={() => setContextMenu({ visible: false, x: 0, y: 0, record: null })}></div>
          <div style={{ position: 'absolute', top: contextMenu.y, left: contextMenu.x, backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-1)', borderRadius: '4px', padding: '5px', zIndex: 10000, display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '150px', boxShadow: '0 4px 6px rgba(0,0,0,0.3)' }}>
            {(isAdmin || contextMenu.record?.user_id === user.id) && (
              <>
                <button
                  onClick={() => {
                    if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
                    setEditMockModal({ visible: true, record: contextMenu.record });
                    setContextMenu({ visible: false, x: 0, y: 0, record: null });
                  }}
                  style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--text-strong)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  ✏️ 수정
                </button>
                {contextMenu.record?.status === 'pending' && (
                  <button
                    onClick={() => {
                      if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
                      const rec = contextMenu.record;
                      const usedNikkes = usedNikkesByIdentityKey[identityKey(rec)] || new Set();
                      const squad = [rec.slot_1_nikke_id, rec.slot_2_nikke_id, rec.slot_3_nikke_id, rec.slot_4_nikke_id, rec.slot_5_nikke_id].filter(Boolean);
                      if (squad.some(nid => usedNikkes.has(nid))) {
                        alert('이미 사용된 니케가 포함되어 있어 실전 투입을 할 수 없습니다.');
                        setContextMenu({ visible: false, x: 0, y: 0, record: null });
                        return;
                      }
                      setApplyDamageModal({ visible: true, record: rec });
                      setContextMenu({ visible: false, x: 0, y: 0, record: null });
                    }}
                    style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--text-strong)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    💥 실제 딜로 적용
                  </button>
                )}
                <button
                  onClick={() => {
                    if (isLockedSeason) return alert("시즌이 잠겨있어 조작할 수 없습니다.");
                    setDeleteModal({ visible: true, record: contextMenu.record });
                    setContextMenu({ visible: false, x: 0, y: 0, record: null });
                  }}
                  style={{ padding: '8px 10px', background: 'transparent', border: 'none', color: 'var(--danger)', textAlign: 'left', cursor: 'pointer', borderRadius: '4px' }}
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--border-1)'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  🗑️ 삭제
                </button>
              </>
            )}
          </div>
        </>
      )}


      <DeleteMockModal
        visible={deleteModal.visible}
        title="모의전 기록 완전 삭제"
        description="해당 모의전 기록을 완전히 삭제하시겠습니까?"
        fullDeleteLabel="영구 삭제"
        onFullDelete={async () => {
          try {
            if (demo.isDemo) demo.deleteMockBattle(deleteModal.record.id);
            else await supabase.from('mock_battles').delete().eq('id', deleteModal.record.id);
            setMockBattles(prev => prev.filter(m => m.id !== deleteModal.record.id));
            setDeleteModal({ visible: false, record: null });
          } catch (err) { console.error(err); }
        }}
        onCancel={() => setDeleteModal({ visible: false, record: null })}
      />

      {editMockModal.visible && (
        <MockBattleUploadModal
          isOpen={true}
          onClose={() => setEditMockModal({ visible: false, record: null })}
          bossStatus={bossBattleStatuses.find(rs => rs.id === editMockModal.record.boss_status_id) || {
            id: editMockModal.record.boss_status_id,
            global_raid_bosses: { name: '알 수 없는 보스', boss_number: selectedBossNum },
            stage_level: '?'
          }}
          guild={guild}
          user={user}
          isAdmin={isAdmin}
          allMembers={allMembers}
          bossBattleStatuses={bossBattleStatuses}
          synchroLevel={synchroLevel}
          setSynchroLevel={setSynchroLevel}
          editData={editMockModal.record}
          onUploadComplete={() => {
            setEditMockModal({ visible: false, record: null });
          }}
        />
      )}

      {applyDamageModal.visible && (
        <ApplyRealDamageModal
          isOpen={true}
          onClose={() => setApplyDamageModal({ visible: false, record: null })}
          mockBattle={applyDamageModal.record}
          bossStatus={bossBattleStatuses.find(rs => rs.id === applyDamageModal.record.boss_status_id)}
          onApplyComplete={() => {
            setApplyDamageModal({ visible: false, record: null });
          }}
        />
      )}

      {isAddModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }} onClick={() => setIsAddModalOpen(false)}>
          <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', width: isNarrow ? '96vw' : '1000px', maxWidth: '95%', height: isNarrow ? '88vh' : undefined, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--surface-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: 'var(--text-strong)' }}>새 모의전 등록</h2>
              <button onClick={() => setIsAddModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}>✕</button>
            </div>

            <div style={isNarrow
              ? { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', minHeight: 0 }
              : { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
              {/* Left: 관리자 추천 스쿼드 입력 */}
              <div style={isNarrow
                ? { padding: '16px', borderBottom: '1px solid var(--surface-1)', flexShrink: 0 }
                : { flex: 1, padding: '20px', borderRight: '1px solid var(--surface-1)', overflowY: 'auto', minHeight: 0 }}>
                <h4 style={{ marginTop: 0, color: 'var(--accent-blurple)' }}>관리자 추천 스쿼드 입력</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>추천 스쿼드를 불러와 스쿼드 슬롯을 채웁니다. 딜량은 직접 입력해주세요.</p>

                {bossRecommendedSquads.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center', backgroundColor: 'var(--surface-1)', borderRadius: '8px' }}>등록된 추천 덱이 없습니다.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {bossRecommendedSquads.map(squad => (
                      <div key={squad.id} style={{ backgroundColor: 'var(--surface-1)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--text-strong)', minWidth: 0, wordBreak: 'break-all' }}>{squad.name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            <SquadMemoBadge memo={squad.memo} isNarrow={isNarrow} />
                            <button
                              type="button"
                              onClick={() => handleLoadRecommendedSquadForNewRecord(squad)}
                              style={{ padding: '8px 10px', backgroundColor: 'var(--accent-blurple)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                              불러오기
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '5px' }}>
                          {[squad.slot_1_nikke_id, squad.slot_2_nikke_id, squad.slot_3_nikke_id, squad.slot_4_nikke_id, squad.slot_5_nikke_id].filter(Boolean).map((nid, i) => (
                            <NikkeAvatar key={i} nikkeId={nid} size={50} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: Form */}
              <div style={isNarrow
                ? { padding: '16px', flexShrink: 0 }
                : { flex: 1, padding: '20px', overflowY: 'auto', minHeight: 0 }}>
                <MockBattleForm
                  isAdmin={isAdmin}
                  submitLabel="등록하기"
                  onSubmit={async (data) => {
                    await handleAddMockBattle(data);
                    setIsAddModalOpen(false);
                  }}
                  onCancel={() => setIsAddModalOpen(false)}
                  initialSynchroLevel={synchroLevel}
                  initialData={newRecordInitialData}
                  usedNikkesByIdentity={usedNikkesByIdentityKey}
                  currentUserId={user?.id}
                  computeIdentityKey={(opts) => identityKey({
                    is_admin_written: opts.isManualTarget,
                    manual_nickname: opts.manualNickname,
                    synchro_level: opts.synchroLevel,
                    user_id: opts.currentUserId,
                  })}
                  isLocked={isLockedSeason}
                  manualTargets={manualTargets}
                  checkPrevSynchro={checkPrevSynchro}
                  bossName={selectedBossInfo?.name || null}
                  bossElement={selectedBossInfo?.element || null}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {memoView !== null && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }} onClick={() => setMemoView(null)}>
          <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', width: '400px', maxWidth: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--surface-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--text-strong)', fontSize: '1rem' }}>📝 덱 메모</h3>
              <button onClick={() => setMemoView(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.3rem' }}>✕</button>
            </div>
            <div style={{ padding: '16px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-strong)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              {memoView}
            </div>
          </div>
        </div>
      )}

      {hoveredMemo.visible && (
        <div style={{
          position: 'fixed',
          top: hoveredMemo.y,
          left: hoveredMemo.x,
          width: '250px',
          backgroundColor: 'var(--surface-1)',
          color: 'var(--text-strong)',
          textAlign: 'left',
          borderRadius: '6px',
          padding: '10px',
          zIndex: 9999,
          border: '1px solid var(--accent-green)',
          whiteSpace: 'pre-wrap',
          wordWrap: 'break-word',
          boxShadow: '0px 4px 10px rgba(0,0,0,0.5)',
          fontSize: '0.9rem',
          pointerEvents: hoveredMemo.isPinned ? 'auto' : 'none',
          cursor: hoveredMemo.isPinned ? 'text' : 'default'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: hoveredMemo.isPinned ? '5px' : '0' }}>
            {hoveredMemo.isPinned && <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>📌 켜짐</span>}
            {hoveredMemo.isPinned && (
              <button
                onClick={() => setHoveredMemo({ visible: false, text: '', x: 0, y: 0, isPinned: false, id: null })}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
              >
                ✕
              </button>
            )}
          </div>
          {hoveredMemo.text}
        </div>
      )}
    </div>
  );
}

export default MockBattleDashboard;
