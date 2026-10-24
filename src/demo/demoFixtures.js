// 체험 모드(비가입자 둘러보기)용 클라이언트 목업 데이터.
// DB에 전혀 접근하지 않고, 워크스페이스 전 기능을 둘러볼 수 있도록 가짜 길드/멤버/보스/모의전/채팅을 만든다.
// buildDemoData(nikkes, currentUser): 실제 니케 데이터(id)를 재사용해 아바타가 정상 렌더되도록 한다.

export const DEMO_GUILD_ID = 'demo-guild';
export const DEMO_SEASON = '체험 시즌';

const nowIso = () => new Date().toISOString();
// n분 전 ISO (샘플 메시지/기록에 시간 흐름을 주기 위함)
const minAgo = (m) => new Date(Date.now() - m * 60000).toISOString();

export function buildDemoData(nikkes, currentUser) {
  const nk = (nikkes || []).map((n) => n.id);
  // 실제 니케 id를 앞에서부터 골라 스쿼드 슬롯을 채운다(없으면 null → 아바타 '?' 폴백).
  const pick = (i) => nk[i] ?? null;
  const squad = (a, b, c, d, e) => ({
    slot_1_nikke_id: pick(a),
    slot_2_nikke_id: pick(b),
    slot_3_nikke_id: pick(c),
    slot_4_nikke_id: pick(d),
    slot_5_nikke_id: pick(e),
  });

  const meId = currentUser.id;

  // ── 길드 / 멤버 ─────────────────────────────────────────────
  const guild = {
    id: DEMO_GUILD_ID,
    name: '체험 길드',
    union_code: '00000000',
    owner_id: meId,
  };

  const mkMember = (user_id, name, role, synchro, status) => ({
    id: `demo-mem-${user_id}`,
    user_id,
    in_game_name: name,
    role,
    status_message: status || '',
    users: { synchro_level: synchro, profile_image_id: null },
  });

  const members = [
    mkMember(meId, '나(체험)', 'admin', 691, '체험 모드로 둘러보는 중'),
    mkMember('demo-u2', '라피', 'sub_admin', 591, '인카운터 준비 완료'),
    mkMember('demo-u3', '아니스', 'member', 548, '방주를 불바다로 만들겠어.'),
    mkMember('demo-u4', '네온', 'member', 604, '火力!'),
    mkMember('demo-u5', '마리안', 'member', 1, '지휘관 붕대 고마웠어요'),
    mkMember('demo-u6', '김니붕', 'member', 488, '하드 노루할 예정'),
    mkMember('demo-u7', 'DORO', 'member', 5080, 'DORO!!'),
  ];

  // ── 채널 / 메시지 ─────────────────────────────────────────────
  const channels = [
    { id: 'demo-ch-notice', union_id: DEMO_GUILD_ID, name: '공지사항', type: 'notice', is_fixed: true, deleted_at: null, created_at: minAgo(600) },
    { id: 'demo-ch-general', union_id: DEMO_GUILD_ID, name: '일반', type: 'general', is_fixed: true, deleted_at: null, created_at: minAgo(600) },
    { id: 'demo-ch-free', union_id: DEMO_GUILD_ID, name: '자유수다', type: 'general', is_fixed: false, deleted_at: null, created_at: minAgo(500) },
  ];

  const mkMsg = (id, channel_id, user_id, content, createdMinAgo) => ({
    id,
    channel_id,
    user_id,
    content,
    created_at: minAgo(createdMinAgo),
    updated_at: null,
    deleted_at: null,
  });

  const messages = [
    mkMsg('demo-msg-1', 'demo-ch-notice', 'demo-u2', '길드 보스전 3타는 선택이 아닌 필수입니다. 지휘관.', 300),
    mkMsg('demo-msg-2', 'demo-ch-notice', 'demo-u2', '노루는 용서하지 않겠습니다.', 290),
    mkMsg('demo-msg-3', 'demo-ch-general', 'demo-u3', '방주의 별이 된다!', 120),
    mkMsg('demo-msg-4', 'demo-ch-general', meId, `<@demo-u3> 언급 시 이렇게 표시됩니다.`, 118),
    mkMsg('demo-msg-5', 'demo-ch-general', 'demo-u4', '[Web발신]너는나를존중해야한다나는건강한몸으로E2크리스탈을맨손으로바사삭냈으며어떠한영향을받지도않았다', 90),
    // 스쿼드 공유 예시
    mkMsg(
      'demo-msg-6',
      'demo-ch-general',
      'demo-u4',
      `$$SQUAD$$${JSON.stringify({ message: '추천덱 공유시 이런 식으로 표시됩니다.', nikkes: [pick(0), pick(1), pick(2), pick(3), pick(4)], image_url: null })}`,
      88,
    ),
    mkMsg('demo-msg-7', 'demo-ch-free', 'demo-u5', '오늘 업데이트 소식 봤어요?', 45),
    mkMsg('demo-msg-8', 'demo-ch-free', 'demo-u6', 'ㅇㅇ 곧 섭종할듯', 40),
  ];

  // ── 시즌 / 보스 / 보스전 현황 ────────────────────────────────
  const seasons = [{ name: DEMO_SEASON, start_date: minAgo(60 * 24 * 7) }];

  const bossDefs = [
    { bn: 1, name: '니힐리스타', element: '수냉', grade: '타일런트' },
    { bn: 2, name: '인디빌리아', element: '작열', grade: '타일런트' },
    { bn: 3, name: '엘트루이아', element: '철갑', grade: '타일런트' },
    { bn: 4, name: '에고비스타', element: '전격', grade: '타일런트' },
    { bn: 5, name: '애니힐리오', element: '풍압', grade: '타일런트' },
  ];

  // 각 보스: 1단계 클리어(HP 0), 2단계 진행중(HP 일부), 3단계(보스5는 4단계까지) 미시작(풀피)
  const bossBattleStatuses = [];
  bossDefs.forEach(({ bn, name, element, grade }) => {
    const maxStage = bn === 5 ? 4 : 3;
    const bossObj = { id: `demo-b-${bn}`, boss_number: bn, name, element, boss_grade: grade, season_name: DEMO_SEASON };
    for (let stage = 1; stage <= maxStage; stage++) {
      const fullHp = 2_000_000_000 * stage;
      const isCleared = stage === 1;
      const currentHp = stage === 1 ? 0 : stage === 2 ? Math.round(fullHp * 0.55) : fullHp;
      bossBattleStatuses.push({
        id: `demo-rs-${bn}-${stage}`,
        stage_level: stage,
        current_hp: currentHp,
        is_cleared: isCleared,
        global_raid_bosses: bossObj,
      });
    }
  });

  // 단계별 최대 체력(지휘 채팅방의 체력 바 분모). 위 fullHp = 2e9 * stage 와 같은 값이어야 한다.
  const hpSettings = [1, 2, 3, 4].map(stage => ({
    stage_level: stage,
    lord_hp: 2_000_000_000 * stage,
    tyrant_hp: 2_000_000_000 * stage,
  }));

  const statusId = (bn, stage) => `demo-rs-${bn}-${stage}`;

  // ── 모의전(모의전 풀 pending + 실전 completed) ────────────────
  const mkMock = (id, over) => ({
    id,
    union_id: DEMO_GUILD_ID,
    user_id: over.user_id ?? null,
    boss_status_id: over.boss_status_id,
    expected_damage: over.expected_damage,
    real_damage: over.real_damage ?? null,
    status: over.status ?? 'pending',
    is_queued: over.is_queued ?? false,
    is_in_calc: over.is_in_calc ?? false,
    is_admin_written: over.is_admin_written ?? false,
    manual_nickname: over.manual_nickname ?? null,
    is_last_hit: over.is_last_hit ?? false,
    synchro_level: over.synchro_level ?? null,
    completed_at: over.completed_at ?? null,
    memo: over.memo ?? null,
    ...squad(over.s0, over.s1, over.s2, over.s3, over.s4),
  });

  const mockBattles = [
    // 1넴 2단계 모의전 풀(pending)
    mkMock('demo-mb-1', { user_id: 'demo-u3', boss_status_id: statusId(1, 2), expected_damage: 420_000_000, synchro_level: 310, s0: 0, s1: 1, s2: 2, s3: 3, s4: 4 }),
    mkMock('demo-mb-2', { user_id: 'demo-u5', boss_status_id: statusId(1, 2), expected_damage: 510_000_000, synchro_level: 331, s0: 5, s1: 6, s2: 2, s3: 3, s4: 7 }),
    mkMock('demo-mb-3', { user_id: meId, boss_status_id: statusId(1, 2), expected_damage: 480_000_000, synchro_level: 325, s0: 0, s1: 2, s2: 4, s3: 6, s4: 8, memo: '2버스트에 궁 쓰고 풀버스트 유지\n막타 직전 스킬 아껴두기' }),
    // 2넴 2단계 풀
    mkMock('demo-mb-4', { user_id: 'demo-u6', boss_status_id: statusId(2, 2), expected_damage: 390_000_000, synchro_level: 305, s0: 1, s1: 3, s2: 5, s3: 7, s4: 9 }),
    mkMock('demo-mb-5', { user_id: 'demo-u4', boss_status_id: statusId(2, 2), expected_damage: 445_000_000, synchro_level: 298, s0: 2, s1: 4, s2: 6, s3: 8, s4: 0 }),
    // 관리자 수기 입력 예시
    mkMock('demo-mb-6', { is_admin_written: true, manual_nickname: '외부용병', boss_status_id: statusId(1, 2), expected_damage: 610_000_000, synchro_level: 350, s0: 0, s1: 1, s2: 2, s3: 3, s4: 5 }),

    // 실전 완료(보스전 현황 랭킹용) — 1넴 1단계
    mkMock('demo-mb-c1', { user_id: 'demo-u2', boss_status_id: statusId(1, 1), expected_damage: 720_000_000, real_damage: 715_000_000, status: 'completed', completed_at: minAgo(200), synchro_level: 340, s0: 0, s1: 1, s2: 2, s3: 3, s4: 4 }),
    mkMock('demo-mb-c2', { user_id: 'demo-u4', boss_status_id: statusId(1, 1), expected_damage: 560_000_000, real_damage: 552_000_000, status: 'completed', completed_at: minAgo(190), synchro_level: 298, s0: 5, s1: 6, s2: 7, s3: 8, s4: 9 }),
    mkMock('demo-mb-c3', { user_id: 'demo-u5', boss_status_id: statusId(1, 1), expected_damage: 680_000_000, real_damage: 690_000_000, status: 'completed', completed_at: minAgo(180), synchro_level: 331, s0: 2, s1: 3, s2: 4, s3: 5, s4: 6 }),
    mkMock('demo-mb-c4', { user_id: meId, boss_status_id: statusId(1, 1), expected_damage: 500_000_000, real_damage: 498_000_000, status: 'completed', completed_at: minAgo(150), synchro_level: 325, s0: 0, s1: 2, s2: 4, s3: 6, s4: 8 }),
  ];

  // ── 추천덱 / 보스 메모 / 지휘 채팅 ───────────────────────────
  const recommendedSquads = [
    { id: 'demo-sq-1', union_id: DEMO_GUILD_ID, season_name: DEMO_SEASON, boss_number: 1, name: '추천 스쿼드 표시는', memo: '추천 스쿼드별 메모는', created_by: meId, ...squad(0, 1, 2, 3, 4) },
    { id: 'demo-sq-2', union_id: DEMO_GUILD_ID, season_name: DEMO_SEASON, boss_number: 1, name: '이렇게 나옵니다', memo: '이렇게 나옵니다.', created_by: meId, ...squad(5, 6, 7, 8, 9) },
    { id: 'demo-sq-3', union_id: DEMO_GUILD_ID, season_name: DEMO_SEASON, boss_number: 2, name: '이러면 죽임', memo: null, created_by: meId, ...squad(1, 2, 3, 4, 5) },
  ];

  const bossMemos = [
    { id: 'demo-memo-1', union_id: DEMO_GUILD_ID, season_name: DEMO_SEASON, boss_number: 1, memo: '보스별 메모는 이런 방식으로 표시됩니다.' },
  ];

  const mkBossBattleMsg = (id, room_type, user_id, content, createdMinAgo) => ({
    id,
    union_id: DEMO_GUILD_ID,
    user_id,
    room_type,
    // 지휘 채팅은 시즌에 물려 있다(raid_messages.season_name)
    season_name: DEMO_SEASON,
    content,
    created_at: minAgo(createdMinAgo),
    updated_at: null,
    deleted_at: null,
  });

  const bossBattleMessages = [
    mkBossBattleMsg('demo-rm-1', 'general', 'demo-u4', '지휘 메시지는', 60),
    mkBossBattleMsg('demo-rm-2', 'general', 'demo-u5', '이렇게 현황판과', 55),
    mkBossBattleMsg('demo-rm-3', 'general', meId, '동시에 볼 수 있어요', 50),
    mkBossBattleMsg('demo-rm-4', 'admin', 'demo-u2', '해당 탭은 관리자만 볼 수 있어요.', 40),
  ];

  return {
    guild,
    members,
    channels,
    messages,
    seasons,
    bossBattleStatuses,
    hpSettings,
    mockBattles,
    recommendedSquads,
    bossMemos,
    bossBattleMessages,
    messageReactions: [],
    seasonSettings: { is_locked: false },
    _createdAt: nowIso(),
  };
}
