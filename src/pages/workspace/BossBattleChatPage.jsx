import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { onGuildChanges } from '../../lib/realtime';
import { useDemo } from '../../demo/DemoContext';
import { useGameData } from '../../contexts/GameDataContext';
import { useBossBattleSeasons } from '../../hooks/useBossBattleSeasons';
import { usePreferences } from '../../hooks/usePreferences';
import { makeIdentity } from '../../lib/identity';
import { formatHp as fmtHp, formatHpShort } from '../../lib/format';
import { isManager } from '../../lib/roles';
import BossBattleChatPanel from './BossBattleChatPanel';
import MemberBossBattleRecordModal from './MemberBossBattleRecordModal';
import BossInfoModal from './BossInfoModal';
import MockBattleUploadModal from './MockBattleUploadModal';
import './BossBattleChatPage.css';

// 속성 아이콘 이모지 폴백 (game_icons 미등록 시) — 지휘 현황판과 동일
const ELEMENT_ICON = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };

// 3타수를 모두 소모한 인물의 계산기 기록은 현황판에서 빠지므로, 여기 합계에서도 뺀다.
const MAX_HITS_PER_SEASON = 3;

const BOSS_NUMBERS = [1, 2, 3, 4, 5];

const slotIds = (mb) => [mb.slot_1_nikke_id, mb.slot_2_nikke_id, mb.slot_3_nikke_id, mb.slot_4_nikke_id, mb.slot_5_nikke_id];

/**
 * 지휘 채팅방.
 * 지휘 네비의 '지휘 채팅방' 버튼으로 들어오는 화면. 상단에 보스 현황(이름/약점/체력 바),
 * 그 아래에 기존 지휘 채팅(BossBattleChatPanel)을 둔다.
 *
 * 체력 바의 분모(단계별 최대 체력)는 union_raid_status에 없고 raid_season_hp_settings에만 있어
 * 별도로 조회한다(결산 화면 SettlementBoss와 같은 방식).
 */
export default function BossBattleChatPage() {
  const {
    guild, user, role, allMembers, inGameName, profileImagesMap,
    bossBattleUnread, setBossBattleUnread, isNarrow, synchroLevel, setSynchroLevel,
    subscribeBossBattleMessages,
  } = useOutletContext();
  const demo = useDemo();
  const isAdmin = isManager(role);
  const { gameIcons } = useGameData();
  const { hpMode } = usePreferences();
  const { seasons, selectedSeason, setSelectedSeason } = useBossBattleSeasons(guild?.id);

  const [statuses, setStatuses] = useState([]);
  const [mocks, setMocks] = useState([]);
  // stage_level → { lord_hp, tyrant_hp }
  const [hpSettings, setHpSettings] = useState({});
  // 지금 들고 있는 데이터가 어느 시즌 것인지. 시즌을 바꾼 직후 이전 시즌 수치가
  // 새 시즌 이름표를 달고 잠깐 보이는 것을 막는다.
  const [dataSeason, setDataSeason] = useState(null);
  // 클릭한 사람의 이 시즌 보스전 기록 모달 (user_id)
  const [recordUserId, setRecordUserId] = useState(null);
  // 보스 이름 클릭 → 보스 정보 모달(모의전 탭의 보스 메모 / 관리자 추천 덱). 지휘 현황판과 같은 소스.
  const [bossMemos, setBossMemos] = useState([]);
  const [recommendedSquads, setRecommendedSquads] = useState([]);
  const [bossInfoNum, setBossInfoNum] = useState(null);
  // 보스 정보 모달에서 '모의전 기록 추가'로 넘어갔을 때 대상이 되는 보스 단계(union_raid_status 행).
  const [uploadBossStatus, setUploadBossStatus] = useState(null);

  // 지휘 채팅은 시즌에 물려 있다. 지난 시즌 방은 열람만 — 끝난 보스전에 새 글이 붙으면
  // 안읽음 표시가 현재 시즌 방과 엉킨다.
  const isCurrentSeason = seasons.length > 0 && selectedSeason === seasons[0].name;

  // 길드 설정에서 보스전 기록을 잠근 시즌은 지휘 채팅도 열람만 된다(서버 RLS로도 막혀 있다).
  // 어느 시즌의 값인지 함께 들고 있어, 시즌을 바꾼 직후 이전 시즌 잠금 상태가 잠깐 쓰이지 않게 한다.
  const [lockInfo, setLockInfo] = useState({ season: null, locked: false });
  const isLockedSeason = lockInfo.season === selectedSeason && lockInfo.locked;
  // 종료일(end_date, KST 기준 그날까지)이 지난 시즌도 잠그지 않았더라도 새 글은 받지 않는다.
  const selectedSeasonRow = seasons.find(s => s.name === selectedSeason);
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isEndedSeason = !!selectedSeasonRow?.end_date && String(selectedSeasonRow.end_date).slice(0, 10) < todayKst;
  const chatLockReason = isLockedSeason ? 'locked' : (isEndedSeason ? 'ended' : null);

  useEffect(() => {
    if (!selectedSeason || !guild?.id || demo.isDemo) return;
    let alive = true;
    supabase.from('union_raid_season_settings').select('is_locked')
      .eq('union_id', guild.id).eq('season_name', selectedSeason).maybeSingle()
      .then(({ data }) => {
        if (alive) setLockInfo({ season: selectedSeason, locked: data?.is_locked || false });
      });
    return () => { alive = false; };
  }, [guild?.id, selectedSeason, demo.isDemo]);

  const elementIconUrl = (element) =>
    gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;

  // 지휘 현황판의 boardHp와 같은 표기 규칙(간이 = "#조 #억", 상세 = 천단위 콤마)
  const boardHp = (hp) => (hpMode === 'simple' ? formatHpShort(hp) : fmtHp(hp, 'detail'));

  useEffect(() => {
    if (!selectedSeason) return;

    // 체험 모드: 목업 스토어에서 구성하고 realtime 구독은 생략
    if (demo.isDemo) {
      const d = demo.data;
      if (!d) return;
      const st = (d.bossBattleStatuses || []).filter(s => s.global_raid_bosses.season_name === selectedSeason);
      const ids = new Set(st.map(s => s.id));
      const hp = {};
      (d.hpSettings || []).forEach(r => { hp[r.stage_level] = r; });
      setStatuses(st);
      setMocks((d.mockBattles || []).filter(b => ids.has(b.boss_status_id)));
      setHpSettings(hp);
      setBossMemos((d.bossMemos || []).filter(m => m.season_name === selectedSeason));
      setRecommendedSquads((d.recommendedSquads || []).filter(s => s.season_name === selectedSeason));
      setDataSeason(selectedSeason);
      return;
    }

    if (!guild?.id) return;
    let alive = true;

    (async () => {
      try {
        const { data: st, error } = await supabase
          .from('union_raid_status')
          .select(`
            id, stage_level, current_hp, is_cleared,
            global_raid_bosses!inner ( id, boss_number, name, element, boss_grade, season_name )
          `)
          .eq('union_id', guild.id)
          .eq('global_raid_bosses.season_name', selectedSeason);
        if (error) throw error;
        if (!alive) return;

        const statusIds = (st || []).map(s => s.id);
        // 보스 메모 / 추천 덱은 보스 정보 모달에서만 쓰이지만, 모달을 열 때마다 왕복하면
        // 첫 클릭이 빈 내용으로 깜빡인다. 어차피 시즌당 몇 행이라 여기서 같이 받아 둔다.
        const [mockRes, hpRes, memoRes, squadRes] = await Promise.all([
          statusIds.length > 0
            ? supabase.from('mock_battles').select('*').eq('union_id', guild.id).in('boss_status_id', statusIds)
            : Promise.resolve({ data: [] }),
          supabase.from('raid_season_hp_settings').select('stage_level, lord_hp, tyrant_hp').eq('season_name', selectedSeason),
          supabase.from('union_boss_memos').select('*').eq('union_id', guild.id).eq('season_name', selectedSeason),
          supabase.from('recommended_squads').select('*').eq('union_id', guild.id).eq('season_name', selectedSeason),
        ]);
        if (!alive) return;

        const hp = {};
        (hpRes.data || []).forEach(r => { hp[r.stage_level] = r; });
        setStatuses(st || []);
        setMocks(mockRes.data || []);
        setHpSettings(hp);
        setBossMemos(memoRes.data || []);
        setRecommendedSquads(squadRes.data || []);
        setDataSeason(selectedSeason);
      } catch (err) {
        console.error('보스 현황 로드 실패:', err);
      }
    })();

    // 체력/계산기 값이 실시간으로 따라가야 하므로 이 화면도 자체 구독을 갖는다
    // (지휘 현황판의 구독은 그 페이지가 떠 있는 동안에만 살아 있다).
    const rtId = Date.now();
    const statusChannel = supabase.channel(`boss_battle_chat_status_${rtId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'union_raid_status', filter: `union_id=eq.${guild.id}` }, payload => {
        setStatuses(prev => prev.map(rs => rs.id === payload.new.id ? { ...rs, ...payload.new } : rs));
      })
      .subscribe();

    const mockChannel = supabase.channel(`boss_battle_chat_mocks_${rtId}`);
    onGuildChanges(mockChannel, 'mock_battles', guild.id, payload => {
      // 이 시즌 밖의 기록은 boss_status_id가 statuses에 없어 계산에서 자연히 무시된다.
      if (payload.new && payload.new.union_id && payload.new.union_id !== guild.id) return;
      if (payload.eventType === 'INSERT') {
        setMocks(prev => prev.some(m => m.id === payload.new.id) ? prev : [...prev, payload.new]);
      } else if (payload.eventType === 'UPDATE') {
        setMocks(prev => prev.map(m => m.id === payload.new.id ? { ...m, ...payload.new } : m));
      } else if (payload.eventType === 'DELETE') {
        setMocks(prev => prev.filter(m => m.id !== payload.old.id));
      }
    });
    // 보스 정보 모달용. 관리자가 모의전 탭에서 메모/추천 덱을 고치면 여기서도 바로 반영된다.
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
      alive = false;
      supabase.removeChannel(statusChannel);
      supabase.removeChannel(mockChannel);
    };
  }, [guild?.id, selectedSeason, demo.isDemo, demo.rev]);

  const identity = useMemo(() => makeIdentity(allMembers), [allMembers]);
  const identityKey = identity.identityKey;

  // 3타 소진 인물 — 지휘 현황판의 계산기 목록과 같은 기준으로 합계를 맞추기 위함
  const exhaustedKeys = useMemo(() => {
    const counts = {};
    mocks.forEach(mb => {
      if (mb.status !== 'completed') return;
      const k = identityKey(mb);
      counts[k] = (counts[k] || 0) + 1;
    });
    return new Set(Object.entries(counts).filter(([, c]) => c >= MAX_HITS_PER_SEASON).map(([k]) => k));
  }, [mocks, identityKey]);

  /* 모의전 업로드 모달에 넘길 "이미 쓴 니케" 집계 — 지휘 현황판(BossBattleDashboard)과 같은 규칙.
     안 넘기면 모달이 중복 편성을 못 걸러내므로, 여기서도 같은 값을 만들어 준다. */

  // 완료 + 계산기 적용분까지 — "사용됨" 회색 표시용
  const usedNikkesByUserId = useMemo(() => {
    const map = {};
    mocks.forEach(mb => {
      if (mb.status !== 'completed' && !mb.is_in_calc) return;
      const key = identityKey(mb);
      (map[key] ||= new Set());
      slotIds(mb).forEach(nid => { if (nid) map[key].add(nid); });
    });
    return map;
  }, [mocks, identityKey]);

  // 완료 타수만 — "실전 사용됨" 빨간 표시용
  const battleUsedByIdentity = useMemo(() => {
    const map = {};
    mocks.forEach(mb => {
      if (mb.status !== 'completed') return;
      const key = identityKey(mb);
      (map[key] ||= new Set());
      slotIds(mb).forEach(nid => { if (nid) map[key].add(nid); });
    });
    return map;
  }, [mocks, identityKey]);

  /**
   * 채팅 머리말에 붙일 "이번 시즌 소모 타수" — user_id → { hits, cap, elements }.
   * elements는 때린 순서대로 보스의 약점 속성 하나씩(같은 속성을 두 번 때렸으면 두 번 들어간다).
   * 아이콘 URL까지 여기서 붙여 보내, 채팅 쪽은 game_icons를 몰라도 되게 한다.
   */
  const hitStatusByUserId = useMemo(() => {
    const elementByStatus = {};
    statuses.forEach(s => { elementByStatus[s.id] = s.global_raid_bosses.element; });

    const byIdentity = {};
    mocks.forEach(mb => {
      if (mb.status !== 'completed') return;
      const element = elementByStatus[mb.boss_status_id];
      if (!element) return;
      const key = identityKey(mb);
      (byIdentity[key] ||= []).push({ at: mb.completed_at, element });
    });
    Object.values(byIdentity).forEach(list => list.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)));

    // gameIcons를 여기서 직접 훑는다 — 아이콘이 늦게 도착하면 그때 다시 계산되도록.
    const iconUrl = (element) =>
      gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;

    const map = {};
    allMembers.forEach(m => {
      const list = byIdentity[identity.memberIdentityKey(m)] || [];
      map[m.user_id] = {
        hits: list.length,
        cap: MAX_HITS_PER_SEASON,
        elements: list.map(h => ({
          name: h.element,
          url: iconUrl(h.element),
          emoji: ELEMENT_ICON[h.element] || '',
        })),
      };
    });
    return map;
  }, [statuses, mocks, allMembers, identity, identityKey, gameIcons]);

  const bossRows = useMemo(() => {
    const maxStageBoss5 = statuses
      .filter(s => s.global_raid_bosses.boss_number === 5)
      .reduce((max, s) => Math.max(max, s.stage_level), 0);

    return BOSS_NUMBERS.map(bNum => {
      const list = statuses.filter(s => s.global_raid_bosses.boss_number === bNum);
      if (list.length === 0) return { bNum, empty: true };

      // 표시 단계 = 아직 안 잡은 최저 단계. 전부 잡았으면 마지막 단계(토벌 완료)를 보여준다.
      const uncleared = list.filter(s => !s.is_cleared);
      const wantLowest = uncleared.length > 0;
      const status = (wantLowest ? uncleared : list).reduce((pick, s) => (
        (wantLowest ? s.stage_level < pick.stage_level : s.stage_level > pick.stage_level) ? s : pick
      ));

      const boss = status.global_raid_bosses;
      const hpRow = hpSettings[status.stage_level];
      const maxHp = hpRow ? Number(boss.boss_grade === '로드급' ? hpRow.lord_hp : hpRow.tyrant_hp) : null;
      // 5번 보스의 마지막 단계는 체력이 0에서 누적되는 무한 단계라 체력 설정 행이 없다.
      const isInfinite = bNum === 5 && status.stage_level === maxStageBoss5 && maxHp == null;

      const calcSum = mocks.reduce((sum, mb) => (
        mb.boss_status_id === status.id
          && mb.status === 'pending'
          && mb.is_queued === true
          && mb.is_in_calc
          && !exhaustedKeys.has(identityKey(mb))
          ? sum + Number(mb.expected_damage || 0)
          : sum
      ), 0);

      const rawHp = Number(status.current_hp || 0);

      if (isInfinite) {
        return { bNum, boss, status, stage: status.stage_level, isInfinite: true, dealt: rawHp, calcSum };
      }

      const remaining = maxHp != null ? Math.min(Math.max(0, rawHp), maxHp) : Math.max(0, rawHp);
      // 계산기 합이 남은 체력을 넘으면(오버킬) 바 밖으로 넘치지 않도록 잘라 그린다.
      const calcApplied = Math.min(calcSum, remaining);
      const pct = (v) => (maxHp > 0 ? (v / maxHp) * 100 : 0);

      return {
        bNum,
        boss,
        status,
        stage: status.stage_level,
        isCleared: status.is_cleared,
        maxHp,
        remaining,
        calcSum,
        isOverkill: calcSum > remaining,
        remainPct: pct(remaining - calcApplied),
        calcPct: pct(calcApplied),
        lostPct: maxHp != null ? pct(maxHp - remaining) : 0,
        pctLeft: maxHp > 0 ? (remaining / maxHp) * 100 : null,
      };
    });
  }, [statuses, mocks, hpSettings, exhaustedKeys, identityKey]);

  const hasBossData = statuses.length > 0 && dataSeason === selectedSeason;

  const renderHpCell = (row) => {
    if (row.empty) return <div className="rbt-empty">데이터 없음</div>;

    if (row.isInfinite) {
      return (
        <>
          {/* "가한 대미지" 머리말을 붙이면 좁은 칸에서 두 줄로 접혀 이 칸만 늘어진다.
              무슨 수치인지는 칸 툴팁(hpTitle)이 그대로 설명한다. */}
          <div className="rbt-infinite">{boardHp(row.dealt)}</div>
          {row.calcSum > 0 && <div className="rbt-hpcalc">계산기 +{boardHp(row.calcSum)}</div>}
        </>
      );
    }

    if (row.isCleared) {
      return <div className="rbt-cleared">토벌 완료</div>;
    }

    if (row.maxHp == null) {
      // 시즌 체력 설정이 없어 분모를 모르는 경우 — 바 대신 남은 체력만 표기
      return <div className="rbt-hplabel">남은 체력 {boardHp(row.remaining)}</div>;
    }

    return (
      <>
        <div className="rbt-hpbar">
          <div className="rbt-hpbar__seg--remain" style={{ width: `${row.remainPct}%` }} />
          <div className="rbt-hpbar__seg--calc" style={{ width: `${row.calcPct}%` }} />
          <div className="rbt-hpbar__seg--lost" style={{ width: `${row.lostPct}%` }} />
        </div>
        <div className="rbt-hplabel">
          {boardHp(row.remaining)}
          <span className="rbt-hplabel__pct">· {row.pctLeft.toFixed(1)}%</span>
        </div>
        {row.calcSum > 0 && (
          <div className="rbt-hpcalc">
            계산기 −{boardHp(row.calcSum)}{row.isOverkill ? ' (오버킬)' : ''}
          </div>
        )}
      </>
    );
  };

  // 체력 칸 전체에 붙이는 툴팁 — 폭이 좁아 줄바꿈된 값을 한 줄로 다시 확인할 수 있게 한다.
  const hpTitle = (row) => {
    if (row.empty) return undefined;
    if (row.isInfinite) {
      return `가한 대미지 ${boardHp(row.dealt)}${row.calcSum > 0 ? ` / 계산기 예정 +${boardHp(row.calcSum)}` : ''}`;
    }
    const base = `남은 체력 ${boardHp(row.remaining)}${row.maxHp != null ? ` / 최대 ${boardHp(row.maxHp)}` : ''}`;
    return row.calcSum > 0
      ? `${base} / 계산기 예정 −${boardHp(row.calcSum)}${row.isOverkill ? ' (오버킬)' : ''}`
      : base;
  };

  return (
    <div className={`boss-battle-chat-page${isNarrow ? ' narrow' : ''}`}>
      <div className="boss-battle-chat-page__inner">
        {/* 시즌 선택은 데이터를 불러오는 중에도 계속 자리를 지켜야 한다(다시 되돌릴 수 있도록). */}
        <div className="boss-battle-boss-panel">
          <div className="boss-battle-boss-panel__head">
            <span className="boss-battle-boss-panel__title">보스 현황</span>
            {seasons.length > 0 ? (
              /* 시즌 선택은 보스 현황과 채팅방을 함께 옮긴다 — 지휘 채팅이 시즌에 물려 있기 때문. */
              <select
                className="boss-battle-boss-panel__season-select"
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
                title="시즌 선택 (보스 현황 + 지휘 채팅)"
              >
                {seasons.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            ) : (
              <span className="boss-battle-boss-panel__season">등록된 보스전 데이터가 없습니다</span>
            )}
          </div>
          {!hasBossData ? (
            seasons.length > 0 && <div className="boss-battle-boss-panel__season">불러오는 중...</div>
          ) : (
            /* 보스 한 마리 = 카드 하나 = 버튼 하나. 이름·단계·속성·체력까지 칸 전체가 눌린다
               (예전엔 이름 글자만 눌려서 좁은 화면에서 조준하기 어려웠다). */
            <div className="boss-battle-boss-grid">
              {bossRows.map(row => (
                row.empty ? (
                  <div key={row.bNum} className="rbt-card rbt-card--empty">
                    <div className="rbt-name">{row.bNum}번 보스</div>
                    <span className="rbt-element">-</span>
                    <div className="rbt-hp">{renderHpCell(row)}</div>
                  </div>
                ) : (
                  <button
                    key={row.bNum}
                    type="button"
                    className="rbt-card"
                    onClick={() => setBossInfoNum(row.bNum)}
                    title={`${row.boss.name} — 클릭하여 보스 메모 / 추천 덱 보기`}
                  >
                    <div className="rbt-name">{row.boss.name}</div>
                    <span className="rbt-element">
                      <span className="rbt-stage">{row.stage}단계</span>
                      {elementIconUrl(row.boss.element)
                        ? <img src={elementIconUrl(row.boss.element)} alt={row.boss.element} />
                        : <span>{ELEMENT_ICON[row.boss.element] || ''}</span>}
                      {row.boss.element}
                    </span>
                    {/* 체력 값 툴팁은 카드 툴팁보다 안쪽이라 여기 올려두면 이쪽이 이긴다 */}
                    <div className="rbt-hp" title={hpTitle(row)}>{renderHpCell(row)}</div>
                  </button>
                )
              ))}
            </div>
          )}
        </div>

        <div className="boss-battle-chat-page__chat">
          <BossBattleChatPanel
            guild={guild}
            user={user}
            isAdmin={isAdmin}
            allMembers={allMembers}
            bossBattleUnread={bossBattleUnread}
            setBossBattleUnread={setBossBattleUnread}
            inGameName={inGameName}
            profileImagesMap={profileImagesMap}
            seasonName={selectedSeason}
            readOnly={!isCurrentSeason}
            lockReason={chatLockReason}
            subscribeBossBattleMessages={subscribeBossBattleMessages}
            // 보스전 기록/타수 표시는 이 시즌 데이터가 준비됐을 때만 (다른 시즌 것을 띄우지 않도록).
            onMemberClick={hasBossData ? setRecordUserId : undefined}
            hitStatusByUserId={hasBossData ? hitStatusByUserId : undefined}
          />
        </div>
      </div>

      {/* 보스 이름 클릭 → 보스 메모 / 관리자 추천 덱. 현재 시즌이면 여기서 바로 모의전 등록으로 넘어간다
          (지난 시즌은 채팅과 마찬가지로 열람만 — 끝난 보스전에 새 기록을 붙일 이유가 없다). */}
      {bossInfoNum !== null && (() => {
        const row = bossRows.find(r => r.bNum === bossInfoNum);
        return (
          <BossInfoModal
            boss={row?.boss}
            memo={bossMemos.find(m => m.boss_number === bossInfoNum)?.memo}
            squads={recommendedSquads.filter(s => s.boss_number === bossInfoNum)}
            getMemberName={(userId) => allMembers.find(m => m.user_id === userId)?.in_game_name || '삭제됨'}
            isNarrow={isNarrow}
            onAddMockBattle={isCurrentSeason && !chatLockReason && row?.status ? () => {
              setUploadBossStatus(row.status);
              setBossInfoNum(null);
            } : undefined}
            onClose={() => setBossInfoNum(null)}
          />
        );
      })()}

      {/* 모의전 업로드는 지휘 현황판과 같은 모달·같은 인자 — 등록 결과는 위 realtime 구독이 받아 온다. */}
      {uploadBossStatus && (
        <MockBattleUploadModal
          isOpen={true}
          onClose={() => setUploadBossStatus(null)}
          bossStatus={uploadBossStatus}
          guild={guild}
          user={user}
          isAdmin={isAdmin}
          allMembers={allMembers}
          bossBattleStatuses={statuses}
          synchroLevel={synchroLevel}
          setSynchroLevel={setSynchroLevel}
          usedNikkesByUserId={usedNikkesByUserId}
          battleUsedByIdentity={battleUsedByIdentity}
          exhaustedIdentityKeys={exhaustedKeys}
          getIdentityKey={identityKey}
          onUploadComplete={() => setUploadBossStatus(null)}
        />
      )}

      {/* 보스전 기록은 보스 현황을 그리려고 이미 받아 둔 데이터를 그대로 쓴다(추가 조회 없음) */}
      {recordUserId && (
        <MemberBossBattleRecordModal
          seasonName={selectedSeason}
          userId={recordUserId}
          member={allMembers.find(m => m.user_id === recordUserId)}
          statuses={statuses}
          mocks={mocks}
          allMembers={allMembers}
          onClose={() => setRecordUserId(null)}
        />
      )}
    </div>
  );
}
