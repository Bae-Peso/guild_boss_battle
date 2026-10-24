import React, { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { onGuildChanges } from "../../lib/realtime";
import { useDemo } from "../../demo/DemoContext";
import NikkeAvatar from "../../components/NikkeAvatar";
import { SortableTh } from "../../components/TableControls";
import BossBattleSettlementModal from "../../components/BossBattleSettlementModal";
import { useResizableColumn } from "../../hooks/useResizableColumn";
import { usePreferences } from "../../hooks/usePreferences";
import { useBossBattleSeasons } from "../../hooks/useBossBattleSeasons";
import { useGameData } from "../../contexts/GameDataContext";
import { isManager } from "../../lib/roles";
import { formatHp } from "../../lib/format";
import { makeIdentity } from "../../lib/identity";
import './Settlement.css'; // settlement-badge-last(막타 배지) 공유

// 관리자가 속성 이미지를 지정하지 않았을 때의 폴백 이모지
const ELEMENT_ICON = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };

// 시즌당 1인 최대 타수. 남은 타수 = HIT_CAP - 소모한 타수.
const HIT_CAP = 3;
// 남은 타수별 필터 버튼. 0 = 3타 소진(보스전 종료).
const REMAIN_FILTERS = [
  { remain: 3, label: '3타 남음' },
  { remain: 2, label: '2타 남음' },
  { remain: 1, label: '1타 남음' },
  { remain: 0, label: '소진' },
];

function GuildBossBattleStatus() {
  const { guild, allMembers, role, leftCollapsed, rightCollapsed, isNarrow } = useOutletContext();
  const demo = useDemo();
  const admin = isManager(role);
  const { gameIcons } = useGameData();
  // 관리자 설정(게임 아이콘 관리)에서 지정한 속성 이미지 URL
  const elementIconUrl = (element) => gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;
  const [battles, setBattles] = useState([]);
  const { hpMode, setHpMode, showSquad, setShowSquad } = usePreferences();
  const [loading, setLoading] = useState(true);
  const { seasons, selectedSeason, setSelectedSeason, seasonsReady } = useBossBattleSeasons(guild?.id);
  const [seasonStatusIds, setSeasonStatusIds] = useState([]);
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // 남은 타수별 표시 필터. 기본은 전부 표시하고, 버튼을 눌러 그룹 단위로 감춘다.
  // ('소진'을 끄면 예전의 "완료 인원 비표시"와 같은 동작)
  const [remainFilter, setRemainFilter] = useState(() => new Set([3, 2, 1, 0]));
  const toggleRemain = (remain) => {
    setRemainFilter(prev => {
      const next = new Set(prev);
      if (next.has(remain)) next.delete(remain); else next.add(remain);
      return next;
    });
  };
  // 비고(결산 탭과 공유): member_key -> note. 관리자만 편집.
  const [notes, setNotes] = useState({});
  const [noteEdits, setNoteEdits] = useState({});
  // 비고 컬럼 폭(엑셀식 열 너비 조절). 헤더 우측 핸들 드래그로 조절, localStorage 유지.
  const noteCol = useResizableColumn('nikke_status_note_w', 240, { min: 120, max: 640 });

  // 랭킹표 정렬(컬럼 헤더 클릭). 기본은 총 대미지 내림차순. 순위 열은 현재 정렬 순서의 위치를 뜻한다.
  const [rankSortField, setRankSortField] = useState('totalDmg'); // 'name' | 'hits' | 'totalDmg'
  const [rankSortDir, setRankSortDir] = useState('desc');
  const handleRankSort = (field) => {
    if (rankSortField === field) {
      setRankSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setRankSortField(field);
      setRankSortDir(field === 'name' ? 'asc' : 'desc');
    }
  };
  const rankSort = { sortField: rankSortField, sortDir: rankSortDir, handleSort: handleRankSort };

  // 시즌이 없으면 로딩 종료 (기존 fetchSeasons의 setLoading(false) 대체)
  useEffect(() => {
    if (seasonsReady && seasons.length === 0) setLoading(false);
  }, [seasonsReady, seasons.length]);

  const handleJumpToLatest = () => {
    if (seasons.length > 0) setSelectedSeason(seasons[0].name);
  };

  useEffect(() => {
    let isMounted = true;
    
    const fetchTodayBattles = async () => {
      if (!selectedSeason || !guild) return;

      // 체험 모드: 목업 스토어의 완료 타수를 집계
      if (demo.isDemo) {
        const d = demo.data;
        if (!d) return;
        const statuses = d.bossBattleStatuses.filter(s => s.global_raid_bosses.season_name === selectedSeason);
        const statusIds = statuses.map(s => s.id);
        setSeasonStatusIds(statusIds);
        const bossInfoMap = {};
        statuses.forEach(s => { bossInfoMap[s.id] = { ...s.global_raid_bosses, stage_level: s.stage_level }; });
        const completed = d.mockBattles
          .filter(b => b.status === 'completed' && statusIds.includes(b.boss_status_id))
          .sort((a, b) => new Date(a.completed_at || 0) - new Date(b.completed_at || 0))
          .map(b => ({ ...b, bossInfo: bossInfoMap[b.boss_status_id] }));
        setBattles(completed);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        // Fetch statuses for this season first
        const { data: statuses, error: statusErr } = await supabase
          .from('union_raid_status')
          .select('id, stage_level, global_raid_bosses!inner ( boss_number, name, element )')
          .eq('union_id', guild.id)
          .eq('global_raid_bosses.season_name', selectedSeason);

        if (statusErr) throw statusErr;

        const statusIds = statuses ? statuses.map(s => s.id) : [];
        if (isMounted) setSeasonStatusIds(statusIds);

        const bossInfoMap = {};
        if (statuses) {
          statuses.forEach(s => {
            bossInfoMap[s.id] = { ...s.global_raid_bosses, stage_level: s.stage_level };
          });
        }

        if (statusIds.length > 0) {
          // 해당 시즌의 완료(실전) 타수 전체를 집계 (시간/날짜 기준 없음 — 시즌당 최대 3타)
          const { data: bData, error: bErr } = await supabase
            .from('mock_battles')
            .select('*')
            .eq('union_id', guild.id)
            .eq('status', 'completed')
            .in('boss_status_id', statusIds)
            .order('completed_at', { ascending: true });

          if (bErr) throw bErr;

          // Attach boss info
          const enrichedBattles = (bData || []).map(b => ({
            ...b,
            bossInfo: bossInfoMap[b.boss_status_id]
          }));

          if (isMounted) setBattles(enrichedBattles);
        } else {
          if (isMounted) setBattles([]);
        }
        
      } catch (err) {
        console.error("Failed to fetch battles:", err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchTodayBattles();
  }, [guild, selectedSeason, refreshKey, demo.isDemo, demo.rev]);

  // 실시간 갱신: 같은 길드의 모의전(타수)/보스 HP 변경 시 자동 재조회
  useEffect(() => {
    if (demo.isDemo) return; // 체험 모드: realtime 없음 (demo.rev로 재조회)
    if (!guild?.id) return;
    // DELETE(타수 되돌리기/삭제)는 서버 필터가 안 걸려 onGuildChanges 가 따로 필터 없이 받는다.
    const channel = supabase.channel(`guild_boss_battle_status_live_${guild.id}_${Date.now()}`);
    const bump = () => setRefreshKey(k => k + 1);
    onGuildChanges(channel, 'mock_battles', guild.id, bump);
    onGuildChanges(channel, 'union_raid_status', guild.id, bump);
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [guild?.id]);

  const getMemberName = (userId) => {
    const m = allMembers.find(x => x.user_id === userId);
    return m ? m.in_game_name : '알 수 없음';
  };

  // 비고 로드 (결산 탭과 동일한 union_settlement_members 데이터를 공유)
  useEffect(() => {
    if (!guild?.id || !selectedSeason || demo.isDemo) {
      setNotes({}); setNoteEdits({});
      return;
    }
    let alive = true;
    (async () => {
      const snapRes = await supabase
        .from('union_settlement_members').select('member_key, note')
        .eq('union_id', guild.id).eq('season_name', selectedSeason);
      if (!alive) return;
      const map = {};
      (snapRes.data || []).forEach(r => { map[r.member_key] = r.note || ''; });
      setNotes(map);
      setNoteEdits(map);
    })();
    return () => { alive = false; };
    // refreshKey는 제외: 실시간 타수 갱신 때마다 재조회하면 관리자가 입력 중인 비고가 초기화된다.
  }, [guild?.id, selectedSeason, demo.isDemo]);

  // userStats 항목 → 결산 member_key (결산 탭과 동일 규칙: 실멤버 user:<id> / 수기 외부인 manual:<닉네임>)
  const memberKeyOf = (stats) => (stats.userId ? `user:${stats.userId}` : `manual:${stats.name}`);

  const saveNote = async (stats) => {
    if (!admin || demo.isDemo) return;
    const key = memberKeyOf(stats);
    const value = noteEdits[key] ?? '';
    if ((notes[key] || '') === value) return; // 변경 없음
    try {
      const { error } = await supabase.from('union_settlement_members').upsert({
        union_id: guild.id, season_name: selectedSeason, member_key: key,
        user_id: stats.userId || null, manual_nickname: stats.userId ? null : stats.name,
        note: value, updated_at: new Date().toISOString(),
      }, { onConflict: 'union_id,season_name,member_key' });
      if (error) throw error;
      setNotes(prev => ({ ...prev, [key]: value }));
    } catch (err) {
      console.error('비고 저장 실패:', err);
      alert('비고 저장에 실패했습니다.');
    }
  };

  if (loading && seasons.length === 0) {
    return <div style={{ padding: '2rem', color: 'var(--text-strong)' }}>데이터를 불러오는 중...</div>;
  }

  // 닉네임+싱크로 기준으로 집계한다(모든 승인 멤버 포함). 본인 작성 기록과 관리자 수기 기록이라도
  // 닉네임/싱크로가 같으면 동일 인물(멤버)로 합쳐진다. 매칭되는 멤버가 없는 수기 기록만 별도 행.
  const identity = makeIdentity(allMembers);
  const userStats = {};
  allMembers.forEach(m => {
    const key = identity.memberIdentityKey(m);
    if (!userStats[key]) {
      userStats[key] = { hits: [], totalDmg: 0, userId: m.user_id, name: m.in_game_name, synchro: identity.memberSynchro(m) ?? '?' };
    }
  });
  battles.forEach(b => {
    const key = identity.identityKey(b);
    if (!userStats[key]) {
      userStats[key] = {
        hits: [],
        totalDmg: 0,
        userId: b.is_admin_written ? null : b.user_id,
        name: identity.nameOf(b) || (b.is_admin_written ? (b.manual_nickname || '수기 입력') : getMemberName(b.user_id)),
        synchro: identity.synchroOf(b) ?? '?',
      };
    }
    userStats[key].hits.push(b);
    userStats[key].totalDmg += Number(b.real_damage || 0);
  });

  // Calculate overall guild rankings (we would ideally sum up ALL days in the season, but for now we just sum today or what's fetched)
  // Wait, "데미지 순위" implies overall season ranking. Since we only fetched today's battles, we might need a separate query for overall.
  // For simplicity, we just sort the current userStats by total damage.
  
  const rankValue = (s) => {
    if (rankSortField === 'name') return (s.name || '').toLowerCase();
    if (rankSortField === 'hits') return s.hits.length;
    return s.totalDmg;
  };
  const sortedUserIds = Object.keys(userStats).sort((a, b) => {
    const va = rankValue(userStats[a]);
    const vb = rankValue(userStats[b]);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return rankSortDir === 'asc' ? cmp : -cmp;
  });
  // 남은 타수(0~3). 타수를 3개 넘게 가진 이상 데이터가 있어도 음수가 되지 않게 잘라둔다.
  const remainOf = (stats) => Math.max(0, HIT_CAP - stats.hits.length);

  // 남은 타수별 인원 수 — 필터로 감춘 그룹도 개수는 계속 보여준다.
  const remainCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  Object.values(userStats).forEach(s => { remainCounts[remainOf(s)] += 1; });

  // 길드 전체에 남은 타수 합계. 분모는 인원 × 3(정원 32명이면 96타)이며, 필터와 무관하게 전원 기준이다.
  const totalRemain = Object.values(userStats).reduce((sum, s) => sum + remainOf(s), 0);
  const totalCapacity = Object.keys(userStats).length * HIT_CAP;

  // 순위 번호는 전체 기준으로 고정하고, 필터는 표시 목록에서만 제외한다.
  const rankByUid = {};
  sortedUserIds.forEach((uid, i) => { rankByUid[uid] = i; });
  const visibleUserIds = sortedUserIds.filter(uid => remainFilter.has(remainOf(userStats[uid])));

  // 모바일: 순위/플레이어 열 고정 + 나머지 열 가로 스크롤용 스타일 헬퍼
  const stickyCell = (leftPx, isHeader) => isNarrow ? {
    position: 'sticky',
    left: leftPx,
    zIndex: 3,
    backgroundColor: isHeader ? 'var(--surface-1)' : 'var(--surface-2)',
  } : {};
  const rankColStyle = isNarrow ? { width: 44, minWidth: 44, maxWidth: 44 } : { width: '3%' };
  const playerColStyle = isNarrow ? { width: 120, minWidth: 120, maxWidth: 120 } : { width: '10%' };
  const playerSepStyle = isNarrow ? { borderRight: '1px solid var(--border-1)' } : {};
  const noteColStyle = isNarrow ? { minWidth: 180 } : { width: noteCol.width, minWidth: noteCol.width, maxWidth: noteCol.width };
  // 타수 열은 "n / 3" 아래에 "n타 남음"을 한 줄로 붙이므로 5%로는 글자가 잘린다.
  const hitsColStyle = isNarrow ? { minWidth: 72 } : { width: '7%' };
  const hitColStyle = isNarrow ? { minWidth: 130 } : { width: '15%' };
  const totalColStyle = isNarrow ? { minWidth: 96 } : { width: '10%' };

  return (
    <div style={{ padding: '20px', color: 'var(--text-strong)', backgroundColor: 'var(--surface-3)', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: isNarrow ? 'wrap' : undefined, gap: isNarrow ? '8px' : '15px', marginBottom: isNarrow ? '12px' : '20px', paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined, paddingRight: rightCollapsed ? 'var(--panel-collapse-inset)' : undefined }}>
        <h2 style={{ margin: 0, color: 'var(--accent-green)', fontSize: isNarrow ? '1.1rem' : undefined }}>📊 길드 보스전 현황</h2>
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
        <button
          onClick={() => setShowSquad(!showSquad)}
          style={{ background: 'transparent', border: '1px solid var(--border-3)', color: 'var(--text-soft)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem', marginLeft: isNarrow ? 0 : 'auto' }}
        >
          {showSquad ? "스쿼드 숨기기" : "스쿼드 표시"}
        </button>
        <button
          onClick={() => setHpMode(hpMode === 'simple' ? 'detail' : 'simple')}
          style={{ fontSize: '0.85rem', padding: '6px 12px', background: hpMode === 'simple' ? '#3b82f6' : '#ef4444', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          {hpMode === 'simple' ? '간이 모드' : '상세 모드'}
        </button>
      </div>

      {/* 남은 타수 요약 + 필터. 버튼을 끄면 그 그룹이 표에서 빠진다(예: '소진'을 꺼서 종료 인원 감추기). */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: isNarrow ? '12px' : '16px', paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined }}>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>남은 타수</span>
        {REMAIN_FILTERS.map(({ remain, label }) => {
          const on = remainFilter.has(remain);
          const spent = remain === 0;
          const accent = spent ? 'var(--danger)' : 'var(--accent-green)';
          return (
            <button
              key={remain}
              onClick={() => toggleRemain(remain)}
              title={on ? `${label} 인원 감추기` : `${label} 인원 표시`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '5px 10px', borderRadius: '999px', cursor: 'pointer', fontSize: '0.85rem',
                border: `1px solid ${on ? accent : 'var(--border-3)'}`,
                background: on ? accent : 'transparent',
                color: on ? (spent ? 'var(--text-strong)' : 'var(--text-inverse)') : 'var(--text-dim)',
                fontWeight: on ? 'bold' : 'normal',
                opacity: on ? 1 : 0.65,
                whiteSpace: 'nowrap',
              }}
            >
              <span>{label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{remainCounts[remain]}명</span>
            </button>
          );
        })}

        {/* 길드에 남은 타수 총합. 이번 시즌에 아직 얼마나 더 때릴 수 있는지 한눈에 본다. */}
        <div
          title={`길드 전체 ${totalCapacity}타 중 ${totalRemain}타 남음`}
          style={{
            marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: '6px',
            padding: '5px 12px', borderRadius: '6px', whiteSpace: 'nowrap',
            backgroundColor: 'var(--surface-1)', border: '1px solid var(--border-1)',
          }}
        >
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>잔여 합계</span>
          <span style={{ fontWeight: 'bold', fontSize: '1rem', fontVariantNumeric: 'tabular-nums', color: totalRemain === 0 ? 'var(--text-muted)' : 'var(--accent-green)' }}>
            {totalRemain}
          </span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>/ {totalCapacity}타</span>
        </div>
      </div>

      <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', overflow: isNarrow ? 'auto' : 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center', tableLayout: 'fixed', minWidth: isNarrow ? '940px' : undefined }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--surface-1)', borderBottom: '1px solid var(--border-1)' }}>
              <th style={{ padding: '15px 10px', ...rankColStyle, ...stickyCell(0, true) }}>순위</th>
              <SortableTh field="name" sort={rankSort} style={{ padding: '15px 10px', textAlign: 'left', ...playerColStyle, ...stickyCell(44, true), ...playerSepStyle }}>플레이어</SortableTh>
              <th style={{ padding: '15px 10px', textAlign: 'left', position: 'relative', ...noteColStyle }}>비고{!isNarrow && <span {...noteCol.resizerProps} />}</th>
              <SortableTh field="hits" sort={rankSort} style={{ padding: '15px 10px', ...hitsColStyle }}>타수</SortableTh>
              <th style={{ padding: '15px 10px', ...hitColStyle }}>1타</th>
              <th style={{ padding: '15px 10px', ...hitColStyle }}>2타</th>
              <th style={{ padding: '15px 10px', ...hitColStyle }}>3타</th>
              <SortableTh field="totalDmg" sort={rankSort} style={{ padding: '15px 10px', ...totalColStyle }}>총 대미지</SortableTh>
            </tr>
          </thead>
          <tbody>
            {visibleUserIds.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '30px', color: 'var(--text-dim)' }}>{sortedUserIds.length === 0 ? '길드 멤버가 없습니다.' : '표시할 인원이 없습니다. (남은 타수 필터를 확인해주세요)'}</td>
              </tr>
            ) : (
              visibleUserIds.map((uid) => {
                const stats = userStats[uid];
                const idx = rankByUid[uid];
                const nKey = memberKeyOf(stats);
                return (
                  <tr key={uid} style={{ borderBottom: '1px solid var(--border-1)' }}>
                    <td style={{ padding: '15px 10px', fontWeight: 'bold', color: idx < 3 ? 'var(--accent-amber)' : 'var(--text-strong)', ...rankColStyle, ...stickyCell(0, false) }}>{idx + 1}</td>
                    <td style={{ padding: '15px 10px', textAlign: 'left', ...playerColStyle, ...stickyCell(44, false), ...playerSepStyle }}>
                      <div style={{ fontWeight: 'bold' }}>
                        {stats.name}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Lv.{stats.synchro}</div>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'left', verticalAlign: 'middle', ...noteColStyle }}>
                      {admin && !demo.isDemo ? (
                        <textarea
                          value={noteEdits[nKey] ?? ''}
                          onChange={(e) => setNoteEdits(prev => ({ ...prev, [nKey]: e.target.value }))}
                          onBlur={() => saveNote(stats)}
                          placeholder="비고"
                          rows={2}
                          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', padding: '5px 7px', fontSize: '0.8rem', lineHeight: 1.4, background: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-2)', borderRadius: '4px', fontFamily: 'inherit' }}
                        />
                      ) : (
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-soft)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{notes[nKey] || '-'}</span>
                      )}
                    </td>
                    <td style={{ padding: '15px 10px', color: remainOf(stats) === 0 ? 'var(--danger-bright)' : 'var(--accent-green)', fontWeight: 'bold', ...hitsColStyle }}>
                      {stats.hits.length} / {HIT_CAP}
                      <div style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-muted)', marginTop: '2px', whiteSpace: 'nowrap' }}>
                        {remainOf(stats) === 0 ? '소진' : `${remainOf(stats)}타 남음`}
                      </div>
                    </td>
                    {[0, 1, 2].map(hitIdx => {
                      const hit = stats.hits[hitIdx];
                      return (
                        <td key={hitIdx} style={{ padding: '15px 10px', ...hitColStyle }}>
                          {hit ? (
                            <div>
                              <div style={{ fontSize: '0.85rem', color: '#93c5fd', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                <span>Lv.{hit.bossInfo?.stage_level} {hit.bossInfo?.name}</span>
                                {elementIconUrl(hit.bossInfo?.element) ? (
                                  <img src={elementIconUrl(hit.bossInfo?.element)} alt={hit.bossInfo?.element} style={{ width: '16px', height: '16px', objectFit: 'contain', verticalAlign: 'middle' }} />
                                ) : (
                                  <span>{ELEMENT_ICON[hit.bossInfo?.element] || ''}</span>
                                )}
                              </div>
                              {showSquad && (
                                <div style={{ display: 'flex', gap: '2%', margin: '6px 0', justifyContent: 'center', width: '100%' }}>
                                  {[hit.slot_1_nikke_id, hit.slot_2_nikke_id, hit.slot_3_nikke_id, hit.slot_4_nikke_id, hit.slot_5_nikke_id].map((nid, i) => (
                                    <NikkeAvatar key={i} nikkeId={nid} size="18%" style={{ aspectRatio: '1/1' }} />
                                  ))}
                                </div>
                              )}
                              <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
                                {hit.is_last_hit && <span className="settlement-badge-last">막타</span>}
                                <span>{formatHp(hit.real_damage, hpMode)}</span>
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--border-3)' }}>-</span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ padding: '15px 10px', fontWeight: 'bold', color: 'var(--accent-green)', ...totalColStyle }}>
                      {formatHp(stats.totalDmg, hpMode)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <BossBattleSettlementModal 
        isOpen={isSettlementOpen}
        onClose={() => setIsSettlementOpen(false)}
        guildId={guild?.id}
        seasonName={selectedSeason}
        statusIds={seasonStatusIds}
        members={allMembers || []}
      />
    </div>
  );
}

export default GuildBossBattleStatus;
