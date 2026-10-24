import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGameData } from '../contexts/GameDataContext';
import { buildDemoData } from './demoFixtures';

// 체험 모드(비가입자 둘러보기) 컨텍스트.
// - isDemo: 현재 체험 모드 여부 (sessionStorage로 새로고침에도 유지, 단 데이터 스토어는 메모리라 리셋=비영구)
// - data: 목업 스토어 스냅샷 (guild/members/channels/messages/bossBattleStatuses/mockBattles/...)
// - rev: 뮤테이션마다 증가. 페이지 fetch effect 의존성에 넣으면 스토어 변경이 자동 반영됨(실시간 대체)
// - 액션 메서드: 컴포넌트의 기존 "낙관적 갱신" 코드가 그대로 쓰도록, 생성/수정된 row를 반환한다.

const DEMO_FLAG_KEY = 'nikke_demo';

const DemoContext = createContext({ isDemo: false });

const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function DemoProvider({ children }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { nikkes, loading: gameLoading } = useGameData();

  const [isDemo, setIsDemo] = useState(() => {
    try { return sessionStorage.getItem(DEMO_FLAG_KEY) === '1'; } catch { return false; }
  });
  const [data, setData] = useState(null);
  const [rev, setRev] = useState(0);
  const bump = useCallback(() => setRev((r) => r + 1), []);

  // 체험 모드 진입 시(또는 새로고침으로 복원 시) 니케 데이터가 준비되면 스토어를 1회 시드한다.
  useEffect(() => {
    if (isDemo && user && !data && (nikkes.length > 0 || !gameLoading)) {
      setData(buildDemoData(nikkes, user));
    }
  }, [isDemo, user, data, nikkes, gameLoading]);

  const enterDemo = useCallback(() => {
    try { sessionStorage.setItem(DEMO_FLAG_KEY, '1'); } catch { /* ignore */ }
    if (user && nikkes) setData(buildDemoData(nikkes, user));
    setIsDemo(true);
    navigate('/workspace');
  }, [navigate, user, nikkes]);

  const exitDemo = useCallback(() => {
    try { sessionStorage.removeItem(DEMO_FLAG_KEY); } catch { /* ignore */ }
    setIsDemo(false);
    setData(null);
    navigate('/');
  }, [navigate]);

  // ── 액션들 ──────────────────────────────────────────────────
  // 공통: 생성 row를 만들고 스토어에 반영 후 반환.
  const fakeRow = useCallback((over) => ({
    id: uid(),
    created_at: new Date().toISOString(),
    updated_at: null,
    deleted_at: null,
    ...over,
  }), []);

  const insertMessage = useCallback(({ channel_id, content }) => {
    const row = fakeRow({ channel_id, user_id: user.id, content });
    setData((d) => ({ ...d, messages: [...d.messages, row] }));
    bump();
    return row;
  }, [fakeRow, user, bump]);

  const updateMessage = useCallback((id, patch) => {
    setData((d) => ({ ...d, messages: d.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    bump();
  }, [bump]);

  const deleteMessage = useCallback((id) => {
    setData((d) => ({ ...d, messages: d.messages.filter((m) => m.id !== id) }));
    bump();
  }, [bump]);

  const insertBossBattleMessage = useCallback(({ room_type, content, season_name }) => {
    const row = fakeRow({ union_id: data?.guild?.id, user_id: user.id, room_type, content, season_name });
    setData((d) => ({ ...d, bossBattleMessages: [...d.bossBattleMessages, row] }));
    bump();
    return row;
  }, [fakeRow, user, data, bump]);

  const updateBossBattleMessage = useCallback((id, patch) => {
    setData((d) => ({ ...d, bossBattleMessages: d.bossBattleMessages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
    bump();
  }, [bump]);

  const deleteBossBattleMessage = useCallback((id) => {
    setData((d) => ({ ...d, bossBattleMessages: d.bossBattleMessages.filter((m) => m.id !== id) }));
    bump();
  }, [bump]);

  // 메시지 반응 — 일반/지휘 채팅이 한 목록을 쓰고, 대상 컬럼(message_id / raid_message_id)으로 갈린다.
  const toggleMessageReaction = useCallback(({ targetColumn, messageId, emoji }) => {
    setData((d) => {
      const list = d.messageReactions || [];
      const hit = list.find((r) => r[targetColumn] === messageId && r.user_id === user.id && r.emoji === emoji);
      return {
        ...d,
        messageReactions: hit
          ? list.filter((r) => r.id !== hit.id)
          : [...list, fakeRow({ [targetColumn]: messageId, user_id: user.id, emoji })],
      };
    });
    bump();
  }, [fakeRow, user, bump]);

  const insertMockBattle = useCallback((payload) => {
    const row = fakeRow({ ...payload });
    setData((d) => ({ ...d, mockBattles: [...d.mockBattles, row] }));
    bump();
    return row;
  }, [fakeRow, bump]);

  const updateMockBattle = useCallback((id, patch) => {
    let updated = null;
    setData((d) => ({
      ...d,
      mockBattles: d.mockBattles.map((m) => {
        if (m.id !== id) return m;
        updated = { ...m, ...patch };
        return updated;
      }),
    }));
    bump();
    return updated;
  }, [bump]);

  const deleteMockBattle = useCallback((id) => {
    setData((d) => ({ ...d, mockBattles: d.mockBattles.filter((m) => m.id !== id) }));
    bump();
  }, [bump]);

  // 실제 딜 적용: 모의전을 완료 처리 + 보스 HP 차감(막타면 클리어) — 로컬 반영.
  const applyRealDamage = useCallback(({ mockBattleId, bossStatusId, realDamage, subtract, isLastHit }) => {
    setData((d) => ({
      ...d,
      mockBattles: d.mockBattles.map((m) => (m.id === mockBattleId
        ? { ...m, status: 'completed', real_damage: realDamage, is_last_hit: !!isLastHit, is_in_calc: false, completed_at: new Date().toISOString() }
        : m)),
      bossBattleStatuses: d.bossBattleStatuses.map((s) => (s.id === bossStatusId
        ? { ...s, current_hp: Number(s.current_hp) - Number(subtract), is_cleared: isLastHit ? true : s.is_cleared }
        : s)),
    }));
    bump();
  }, [bump]);

  // 실제 딜 되돌리기: 완료된 모의전을 다시 계산기(pending)로 내리고 보스 HP 복구.
  const revertRealDamage = useCallback(({ mockBattleId, bossStatusId, restore }) => {
    setData((d) => ({
      ...d,
      mockBattles: d.mockBattles.map((m) => (m.id === mockBattleId
        ? { ...m, status: 'pending', is_in_calc: true, real_damage: null, is_last_hit: false, completed_at: null }
        : m)),
      bossBattleStatuses: d.bossBattleStatuses.map((s) => (s.id === bossStatusId
        ? { ...s, current_hp: Number(s.current_hp) + Number(restore), is_cleared: false }
        : s)),
    }));
    bump();
  }, [bump]);

  const upsertRecommendedSquad = useCallback((payload, editingId) => {
    if (editingId) {
      const updated = { ...payload, id: editingId };
      setData((d) => ({ ...d, recommendedSquads: d.recommendedSquads.map((s) => (s.id === editingId ? updated : s)) }));
      bump();
      return updated;
    }
    const row = { ...payload, id: uid() };
    setData((d) => ({ ...d, recommendedSquads: [...d.recommendedSquads, row] }));
    bump();
    return row;
  }, [bump]);

  const deleteRecommendedSquad = useCallback((id) => {
    setData((d) => ({ ...d, recommendedSquads: d.recommendedSquads.filter((s) => s.id !== id) }));
    bump();
  }, [bump]);

  const upsertBossMemo = useCallback(({ boss_number, season_name, memo }) => {
    let row = null;
    setData((d) => {
      const existing = d.bossMemos.find((m) => m.boss_number === boss_number && m.season_name === season_name);
      if (existing) {
        row = { ...existing, memo };
        return { ...d, bossMemos: d.bossMemos.map((m) => (m.id === existing.id ? row : m)) };
      }
      row = { id: uid(), union_id: d.guild.id, season_name, boss_number, memo };
      return { ...d, bossMemos: [...d.bossMemos, row] };
    });
    bump();
    return row;
  }, [bump]);

  const setStatusMessage = useCallback((message) => {
    setData((d) => ({ ...d, members: d.members.map((m) => (m.user_id === user.id ? { ...m, status_message: message } : m)) }));
    bump();
  }, [user, bump]);

  const setSynchro = useCallback((level) => {
    setData((d) => ({
      ...d,
      members: d.members.map((m) => (m.user_id === user.id ? { ...m, users: { ...m.users, synchro_level: level } } : m)),
    }));
    bump();
  }, [user, bump]);

  const value = useMemo(() => ({
    isDemo,
    ready: !!data,
    data,
    rev,
    enterDemo,
    exitDemo,
    // actions
    insertMessage, updateMessage, deleteMessage,
    insertBossBattleMessage, updateBossBattleMessage, deleteBossBattleMessage,
    toggleMessageReaction,
    insertMockBattle, updateMockBattle, deleteMockBattle,
    applyRealDamage, revertRealDamage,
    upsertRecommendedSquad, deleteRecommendedSquad,
    upsertBossMemo,
    setStatusMessage, setSynchro,
  }), [
    isDemo, data, rev, enterDemo, exitDemo,
    insertMessage, updateMessage, deleteMessage,
    insertBossBattleMessage, updateBossBattleMessage, deleteBossBattleMessage,
    toggleMessageReaction,
    insertMockBattle, updateMockBattle, deleteMockBattle,
    applyRealDamage, revertRealDamage, upsertRecommendedSquad, deleteRecommendedSquad,
    upsertBossMemo, setStatusMessage, setSynchro,
  ]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export const useDemo = () => useContext(DemoContext);
