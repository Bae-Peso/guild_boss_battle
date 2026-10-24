import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchPrevSeasonSynchro } from '../../lib/prevSynchro';
import { buildManualTargets } from '../../lib/manualTargets';
import MockBattleForm from './MockBattleForm';
import { usePreferences } from '../../hooks/usePreferences';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useIsNarrow } from '../../hooks/useMediaQuery';
import { useGameData } from '../../contexts/GameDataContext';
import { useDemo } from '../../demo/DemoContext';
import NikkeAvatar from '../../components/NikkeAvatar';
import SquadNikke from '../../components/SquadNikke';
import SquadMemoBadge from './SquadMemoBadge';

export default function MockBattleUploadModal({ isOpen, onClose, bossStatus, guild, user, isAdmin, onUploadComplete, allMembers, bossBattleStatuses = [], synchroLevel, setSynchroLevel, editData = null, usedNikkesByUserId = {}, battleUsedByIdentity = {}, exhaustedIdentityKeys = null, getIdentityKey = null }) {
  useEscapeKey(isOpen, onClose);
  const demo = useDemo();
  const isNarrow = useIsNarrow(1200);
  const { hpMode, showSquad } = usePreferences();
  const { nikkes: allNikkes } = useGameData();
  const [savedRecords, setSavedRecords] = useState([]);
  const [recommendedSquads, setRecommendedSquads] = useState([]);
  const [leftPanelMode, setLeftPanelMode] = useState('saved'); // 'saved' | 'recommended'
  const [loading, setLoading] = useState(false);
  const [initialFormData, setInitialFormData] = useState(null);
  const [isLocked, setIsLocked] = useState(false);
  // 기존 기록 불러오기 목록 정렬. 기본은 대미지 내림차순.
  const [savedSort, setSavedSort] = useState({ field: 'damage', dir: 'desc' });
  const handleSavedSort = (field) => {
    setSavedSort((prev) => (prev.field === field
      ? { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { field, dir: field === 'nickname' ? 'asc' : 'desc' }));
  };

  // 수기 입력에서 고를 수 있는 대상: 길드 로스터 + 이 보스에 이미 적힌 수기 닉네임.
  const manualTargets = useMemo(() => buildManualTargets(allMembers, savedRecords), [allMembers, savedRecords]);

  const squadToNikkeArray = (squad) => {
    const ids = [squad.slot_1_nikke_id, squad.slot_2_nikke_id, squad.slot_3_nikke_id, squad.slot_4_nikke_id, squad.slot_5_nikke_id];
    return ids.map(id => (id ? (allNikkes || []).find(n => n.id === id) || null : null));
  };

  // 모달이 닫힐 때 탭 선택과 프리필 데이터를 초기화해, 다음에 다른 보스로 다시 열었을 때
  // (이 컴포넌트는 isOpen prop으로만 토글되고 마운트 상태가 유지되므로) MockBattleForm이
  // 마운트되는 시점에 이미 정리된 initialData를 받도록 한다. isOpen이 true로 바뀔 때 리셋하면
  // 자식(MockBattleForm)이 이미 이전 값으로 마운트된 뒤라 늦다.
  useEffect(() => {
    if (!isOpen) {
      setLeftPanelMode('saved');
      if (!editData) setInitialFormData(null);
    }
  }, [isOpen, editData]);

  useEffect(() => {
    if (!isOpen || !bossStatus) return;

    // 체험 모드: 목업 스토어/전역 니케에서 구성 (네트워크 호출 없음)
    if (demo.isDemo) {
      setIsLocked(false);
      const bossNum = bossStatus.global_raid_bosses.boss_number;
      const matchingStatusIds = (bossBattleStatuses || [])
        .filter(rs => rs.global_raid_bosses.boss_number === bossNum)
        .map(rs => rs.id);
      const d = demo.data;
      if (editData) {
        const slotIds = [editData.slot_1_nikke_id, editData.slot_2_nikke_id, editData.slot_3_nikke_id, editData.slot_4_nikke_id, editData.slot_5_nikke_id];
        setInitialFormData({ ...editData, nikkes: slotIds.map(id => (id ? (allNikkes || []).find(n => n.id === id) || null : null)) });
      } else {
        setSavedRecords((d?.mockBattles || []).filter(mb => matchingStatusIds.includes(mb.boss_status_id) && mb.status === 'pending' && mb.is_queued === false && (isAdmin || mb.user_id === user.id)));
        setRecommendedSquads((d?.recommendedSquads || []).filter(s => s.season_name === bossStatus.global_raid_bosses.season_name && s.boss_number === bossNum));
      }
      return;
    }

    const fetchSavedRecords = async () => {
      setLoading(true);
      try {
        const { data: lockData } = await supabase
          .from('union_raid_season_settings')
          .select('is_locked')
          .eq('union_id', guild.id)
          .eq('season_name', bossStatus.global_raid_bosses.season_name)
          .maybeSingle();
        setIsLocked(lockData?.is_locked || false);

        const bossNum = bossStatus.global_raid_bosses.boss_number;
        const matchingStatusIds = bossBattleStatuses
          .filter(rs => rs.global_raid_bosses.boss_number === bossNum)
          .map(rs => rs.id);

        if (matchingStatusIds.length === 0) {
           setSavedRecords([]);
           return;
        }

        let query = supabase
          .from('mock_battles')
          .select('*')
          .eq('union_id', guild.id)
          .in('boss_status_id', matchingStatusIds)
          .eq('status', 'pending')
          .eq('is_queued', false)
          .order('id', { ascending: false });

        if (!isAdmin) {
          query = query.eq('user_id', user.id);
        }

        const { data, error } = await query;
        if (error) throw error;
        setSavedRecords(data || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    
    const fetchNikkesForEdit = async () => {
      if (!editData) return;
      
      const nikkeIds = [
        editData.slot_1_nikke_id,
        editData.slot_2_nikke_id,
        editData.slot_3_nikke_id,
        editData.slot_4_nikke_id,
        editData.slot_5_nikke_id
      ].filter(Boolean);

      let nikkes = [null, null, null, null, null];
      
      if (nikkeIds.length > 0) {
        const { data } = await supabase.from('nikkes').select('*').in('id', nikkeIds);
        if (data) {
          nikkes = [
            data.find(n => n.id === editData.slot_1_nikke_id) || null,
            data.find(n => n.id === editData.slot_2_nikke_id) || null,
            data.find(n => n.id === editData.slot_3_nikke_id) || null,
            data.find(n => n.id === editData.slot_4_nikke_id) || null,
            data.find(n => n.id === editData.slot_5_nikke_id) || null
          ];
        }
      }

      setInitialFormData({
        ...editData,
        nikkes
      });
    };

    const fetchRecommendedSquads = async () => {
      try {
        const { data, error } = await supabase
          .from('recommended_squads')
          .select('*')
          .eq('union_id', guild.id)
          .eq('season_name', bossStatus.global_raid_bosses.season_name)
          .eq('boss_number', bossStatus.global_raid_bosses.boss_number);
        if (error) throw error;
        setRecommendedSquads(data || []);
      } catch (err) {
        console.error(err);
      }
    };

    if (editData) {
      fetchNikkesForEdit();
    } else {
      fetchSavedRecords();
      fetchRecommendedSquads();
    }
  }, [isOpen, bossStatus, guild, user, isAdmin, bossBattleStatuses, editData, demo.isDemo, demo.data, allNikkes]);

  const getMemberName = (userId) => {
    const m = allMembers.find(x => x.user_id === userId);
    return m ? m.in_game_name : '알 수 없음';
  };

  // 3타수를 모두 소모한 인물은 이번 시즌 길드 보스전이 끝난 것으로 본다. 그 인물의 기록은
  // 더 이상 대기열에 올릴 수 없으므로 불러오기 목록에서 감춘다. (기록 자체는 지우지 않으며
  // 모의전 대시보드에서는 그대로 보인다. 타수를 되돌리면 다시 목록에 나타난다.)
  const visibleSavedRecords = useMemo(() => {
    if (!exhaustedIdentityKeys || !getIdentityKey) return savedRecords;
    return savedRecords.filter(rec => !exhaustedIdentityKeys.has(getIdentityKey(rec)));
  }, [savedRecords, exhaustedIdentityKeys, getIdentityKey]);

  // 목록 정렬: 대미지는 단순 오름/내림차순, 닉네임은 오름/내림차순으로 묶되
  // 같은 닉네임(유저) 내에서는 항상 대미지 내림차순으로 표시한다.
  const sortedSavedRecords = useMemo(() => {
    const arr = [...visibleSavedRecords];
    arr.sort((a, b) => {
      if (savedSort.field === 'nickname') {
        const nameA = a.is_admin_written ? a.manual_nickname : getMemberName(a.user_id);
        const nameB = b.is_admin_written ? b.manual_nickname : getMemberName(b.user_id);
        const cmp = (nameA || '').localeCompare(nameB || '');
        if (cmp !== 0) return savedSort.dir === 'asc' ? cmp : -cmp;
        return (b.expected_damage || 0) - (a.expected_damage || 0);
      }
      const cmp = (a.expected_damage || 0) - (b.expected_damage || 0);
      return savedSort.dir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [visibleSavedRecords, savedSort, allMembers]);

  const handleSelectSaved = async (rec) => {
    // 아래 DB 카운트는 user_id/manual_nickname 단일 기준이라 "본인 작성 + 관리자 수기"가 섞인
    // 인물의 타수를 놓친다. 화면이 이미 병합 기준(identity.js)으로 3타 소진을 알고 있으면 그걸 먼저 쓴다.
    if (exhaustedIdentityKeys && getIdentityKey && exhaustedIdentityKeys.has(getIdentityKey(rec))) {
      alert('해당 시즌에 이미 3회의 실전 기록(완료)이 존재하여, 계산기에 더 이상 등록할 수 없습니다.');
      return;
    }
    if (demo.isDemo) {
      demo.updateMockBattle(rec.id, { is_queued: true });
      alert('대기열에 추가되었습니다!');
      onUploadComplete();
      return;
    }
    try {
      // 3타 체크는 반드시 기록의 실제 소유자(rec) 기준이어야 한다.
      // 이전엔 user.id(현재 로그인한 관리자)로 체크해, 관리자 본인의 타수가 이미 소진된
      // 경우 다른 멤버의 기록을 불러올 때도 잘못 차단되는 버그가 있었다.
      let countQuery = supabase
        .from('mock_battles')
        .select('id, union_raid_status!inner(global_raid_bosses!inner(season_name))')
        .eq('status', 'completed')
        .eq('union_raid_status.global_raid_bosses.season_name', bossStatus.global_raid_bosses.season_name);

      if (rec.is_admin_written) {
        countQuery = countQuery.eq('is_admin_written', true).eq('manual_nickname', rec.manual_nickname);
      } else {
        countQuery = countQuery.eq('user_id', rec.user_id).eq('is_admin_written', false);
      }

      const { data: userCompleted, error: countErr } = await countQuery;

      if (!countErr && userCompleted && userCompleted.length >= 3) {
        alert('해당 시즌에 이미 3회의 실전 기록(완료)이 존재하여, 계산기에 더 이상 등록할 수 없습니다.');
        return;
      }

      const { error } = await supabase
        .from('mock_battles')
        .update({ is_queued: true })
        .eq('id', rec.id);

      if (error) throw error;
      alert('대기열에 추가되었습니다!');
      onUploadComplete();
    } catch (err) {
      console.error(err);
      alert('오류 발생: ' + err.message);
    }
  };

  const handleLoadRecommendedSquad = (squad) => {
    setInitialFormData({ nikkes: squadToNikkeArray(squad) });
  };

  // 지난 시즌 싱크로 조회 (레벨 미갱신 경고용). 체험 모드에서는 건너뛴다.
  const checkPrevSynchro = async ({ isManualTarget, manualNickname }) => {
    if (demo.isDemo || !guild?.id) return null;
    const targetUserId = editData ? editData.user_id : user?.id;
    const memberKey = isManualTarget
      ? (manualNickname ? `manual:${manualNickname}` : null)
      : (targetUserId ? `user:${targetUserId}` : null);
    if (!memberKey) return null;
    return fetchPrevSeasonSynchro(guild.id, bossStatus.global_raid_bosses.season_name, memberKey);
  };

  const handleNewRecordSubmit = async (formData) => {
    if (isLocked) {
      alert("이 시즌은 잠겨있어 더 이상 조작할 수 없습니다.");
      return;
    }
    const { damage, synchroLevel: formSynchro, nikkes, memo, isManualTarget, manualNickname } = formData;
    // 내 프로필 싱크로 동기화는 "내 기록"일 때만 한다.
    // (관리자가 다른 유저 기록을 수정할 때 내 싱크로가 그 유저 값으로 덮이는 버그 방지)
    const isOwnRecord = !isManualTarget && (!editData || editData.user_id === user.id);
    try {
      const payload = {
        union_id: guild.id,
        user_id: editData ? editData.user_id : user.id,
        boss_status_id: bossStatus.id,
        expected_damage: damage,
        is_admin_written: isManualTarget,
        manual_nickname: manualNickname,
        memo: memo,
        synchro_level: formSynchro,
        slot_1_nikke_id: nikkes[0]?.id || null,
        slot_2_nikke_id: nikkes[1]?.id || null,
        slot_3_nikke_id: nikkes[2]?.id || null,
        slot_4_nikke_id: nikkes[3]?.id || null,
        slot_5_nikke_id: nikkes[4]?.id || null
      };

      if (demo.isDemo) {
        if (editData) {
          demo.updateMockBattle(editData.id, payload);
        } else {
          demo.insertMockBattle({ ...payload, status: 'pending', is_queued: true });
        }
        if (isOwnRecord && formSynchro && formSynchro !== synchroLevel) {
          setSynchroLevel(formSynchro);
          demo.setSynchro(formSynchro);
        }
        alert('모의전이 등록되어 대기열에 추가되었습니다!');
        onUploadComplete();
        return;
      }

      if (editData) {
        const { error } = await supabase
          .from('mock_battles')
          .update(payload)
          .eq('id', editData.id);
        if (error) throw error;
      } else {
        // 시즌 기준 3타수(완료) 체크 로직
        let countQuery = supabase
          .from('mock_battles')
          .select('id, union_raid_status!inner(global_raid_bosses!inner(season_name))')
          .eq('status', 'completed')
          .eq('union_raid_status.global_raid_bosses.season_name', bossStatus.global_raid_bosses.season_name);

        if (isManualTarget) {
          countQuery = countQuery.eq('is_admin_written', true).eq('manual_nickname', manualNickname);
        } else {
          countQuery = countQuery.eq('user_id', user.id).eq('is_admin_written', false);
        }

        const { data: userCompleted, error: countErr } = await countQuery;
        if (!countErr && userCompleted && userCompleted.length >= 3) {
          alert('해당 시즌에 이미 3회의 실전 기록(완료)이 존재하여, 계산기에 더 이상 등록할 수 없습니다.');
          return;
        }

        payload.status = 'pending';
        payload.is_queued = true;
        const { error } = await supabase
          .from('mock_battles')
          .insert(payload);
        if (error) throw error;
      }
      
      if (isOwnRecord && formSynchro && formSynchro !== synchroLevel) {
        setSynchroLevel(formSynchro);
        supabase.from('users').update({ synchro_level: formSynchro }).eq('id', user.id).then();
      }

      alert('모의전이 등록되어 대기열에 추가되었습니다!');
      onUploadComplete();
    } catch (err) {
      console.error(err);
      alert('오류 발생: ' + err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--surface-3)', borderRadius: '8px', width: isNarrow ? '96vw' : '1000px', maxWidth: '100%', height: isNarrow ? '88vh' : undefined, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--surface-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface-2)' }}>
          <h3 style={{ margin: 0, color: 'var(--text-strong)' }}>[{bossStatus.global_raid_bosses.name} {bossStatus.stage_level}단계] 모의전 {editData ? '수정' : '업로드'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>
        
        <div style={isNarrow
          ? { display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', minHeight: 0 }
          : { display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

          {/* Left: Saved Records / Recommended Squad */}
          {!editData && (
          <div style={isNarrow
            ? { padding: '16px', borderBottom: '1px solid var(--surface-1)', flexShrink: 0 }
            : { flex: 1, padding: '20px', borderRight: '1px solid var(--surface-1)', overflowY: 'auto', minHeight: 0 }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
              <button
                type="button"
                onClick={() => setLeftPanelMode('saved')}
                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', background: leftPanelMode === 'saved' ? 'var(--accent-green)' : 'var(--surface-1)', color: leftPanelMode === 'saved' ? 'var(--text-inverse)' : 'var(--text-soft)' }}
              >
                기존 기록 불러오기
              </button>
              <button
                type="button"
                onClick={() => setLeftPanelMode('recommended')}
                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', background: leftPanelMode === 'recommended' ? 'var(--accent-blurple)' : 'var(--surface-1)', color: leftPanelMode === 'recommended' ? 'var(--text-strong)' : 'var(--text-soft)' }}
              >
                관리자 추천 스쿼드 입력
              </button>
            </div>

            {leftPanelMode === 'saved' ? (
              <>
                <h4 style={{ marginTop: 0, color: 'var(--accent-green)' }}>기존 기록 불러오기</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>모의전 탭에서 저장해둔 기록을 대기열에 추가합니다.</p>

                {loading ? (
                  <div style={{ color: 'var(--text-dim)' }}>로딩 중...</div>
                ) : sortedSavedRecords.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center', backgroundColor: 'var(--surface-1)', borderRadius: '8px' }}>보관된 기록이 없습니다.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                      <span>정렬:</span>
                      {[{ field: 'nickname', label: '닉네임' }, { field: 'damage', label: '대미지' }].map(({ field, label }) => {
                        const active = savedSort.field === field;
                        return (
                          <button
                            key={field}
                            type="button"
                            onClick={() => handleSavedSort(field)}
                            style={{
                              padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem',
                              border: active ? '1px solid var(--accent-green)' : '1px solid var(--border-3)',
                              background: active ? 'var(--accent-green)' : 'transparent',
                              color: active ? 'var(--text-inverse)' : 'var(--text-soft)',
                              fontWeight: active ? 'bold' : 'normal',
                            }}
                          >
                            {label} {active ? (savedSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </button>
                        );
                      })}
                    </div>
                    {sortedSavedRecords.map(rec => {
                      // 현황판 카드와 같은 표기를 쓴다 — 흑백은 "이미 편성에 쓰임(계산기 포함)",
                      // 빨간 "실전 사용됨"은 실제 타수로 확정된 스쿼드.
                      const recKey = getIdentityKey ? getIdentityKey(rec) : rec.user_id;
                      const usedSet = usedNikkesByUserId[recKey];
                      const battleUsedSet = battleUsedByIdentity[recKey];
                      return (
                      <div key={rec.id} style={{ backgroundColor: 'var(--surface-1)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-1)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <tbody>
                            <tr>
                              <td style={{ textAlign: 'start', fontWeight: 'bold', color: 'var(--text-strong)', paddingBottom: showSquad ? '8px' : '0' }}>
                                <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', marginRight: '4px' }}>(Lv.{rec.synchro_level || '???'})</span>
                                {rec.is_admin_written ? `${rec.manual_nickname} (*관리자)` : getMemberName(rec.user_id)}
                              </td>
                              <td style={{ textAlign: 'end', color: 'var(--text-soft)', paddingBottom: showSquad ? '8px' : '0' }}>
                                딜량: {hpMode === 'simple' ? (rec.expected_damage/100000000).toFixed(1) + '억' : Number(rec.expected_damage).toLocaleString()}
                              </td>
                              <td rowSpan={showSquad ? 2 : 1} style={{ textAlign: 'right', width: '90px', verticalAlign: 'middle', paddingLeft: '10px' }}>
                                <button
                                  onClick={() => handleSelectSaved(rec)}
                                  disabled={isLocked}
                                  style={{ padding: '8px 10px', backgroundColor: isLocked ? 'var(--border-3)' : 'var(--accent-green)', color: isLocked ? 'var(--text-soft)' : 'var(--text-inverse)', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: isLocked ? 'not-allowed' : 'pointer', width: '100%', wordBreak: 'keep-all' }}
                                >
                                  대기열 추가
                                </button>
                              </td>
                            </tr>
                            {showSquad && (
                              <tr>
                                <td colSpan={2}>
                                  <div style={{ display: 'flex', gap: '2%', width: '100%' }}>
                                    {[rec.slot_1_nikke_id, rec.slot_2_nikke_id, rec.slot_3_nikke_id, rec.slot_4_nikke_id, rec.slot_5_nikke_id].filter(Boolean).map((nid, i) => (
                                      <SquadNikke key={i} nikkeId={nid} used={usedSet?.has(nid)} battleUsed={battleUsedSet?.has(nid)} />
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <h4 style={{ marginTop: 0, color: 'var(--accent-blurple)' }}>관리자 추천 스쿼드 입력</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '15px' }}>추천 스쿼드를 불러와 스쿼드 슬롯을 채웁니다. 딜량은 직접 입력해주세요.</p>

                {recommendedSquads.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', padding: '20px', textAlign: 'center', backgroundColor: 'var(--surface-1)', borderRadius: '8px' }}>등록된 추천 덱이 없습니다.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {recommendedSquads.map(squad => (
                      <div key={squad.id} style={{ backgroundColor: 'var(--surface-1)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '8px' }}>
                          <span style={{ fontWeight: 'bold', color: 'var(--text-strong)', minWidth: 0, wordBreak: 'break-all' }}>{squad.name}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            <SquadMemoBadge memo={squad.memo} isNarrow={isNarrow} />
                            <button
                              type="button"
                              onClick={() => handleLoadRecommendedSquad(squad)}
                              style={{ padding: '8px 10px', backgroundColor: 'var(--accent-blurple)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                              불러오기
                            </button>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '2%', width: '100%' }}>
                          {[squad.slot_1_nikke_id, squad.slot_2_nikke_id, squad.slot_3_nikke_id, squad.slot_4_nikke_id, squad.slot_5_nikke_id].filter(Boolean).map((nid, i) => (
                            <NikkeAvatar key={i} nikkeId={nid} size="18%" style={{ aspectRatio: '1/1' }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          )}

          {/* Right: New Mock Battle Form */}
          <div style={isNarrow
            ? { padding: '16px', flexShrink: 0 }
            : { flex: 1, padding: '20px', overflowY: 'auto', minHeight: 0 }}>
            <MockBattleForm
              isAdmin={isAdmin} 
              onSubmit={handleNewRecordSubmit} 
              onCancel={onClose}
              submitLabel={editData ? "수정 완료" : "새로 등록하고 대기열 추가"}
              title={editData ? "✏️ 모의전 기록 수정" : "+ 새 모의전 등록"}
              hideAdminOptions={!!editData}
              initialSynchroLevel={synchroLevel}
              initialData={initialFormData}
              usedNikkesByIdentity={editData ? null : usedNikkesByUserId}
              computeIdentityKey={getIdentityKey ? ((opts) => getIdentityKey({
                is_admin_written: opts.isManualTarget,
                manual_nickname: opts.manualNickname,
                synchro_level: opts.synchroLevel,
                user_id: opts.currentUserId,
              })) : null}
              currentUserId={user?.id}
              usedNikkeIds={editData && getIdentityKey ? Array.from(usedNikkesByUserId[getIdentityKey(editData)] || []) : []}
              isLocked={isLocked}
              manualTargets={manualTargets}
              checkPrevSynchro={checkPrevSynchro}
              bossName={bossStatus?.global_raid_bosses?.name || null}
              bossElement={bossStatus?.global_raid_bosses?.element || null}
            />
          </div>
          
        </div>
      </div>
    </div>
  );
}
