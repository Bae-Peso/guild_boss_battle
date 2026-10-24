import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useOutletContext, useSearchParams, useNavigate } from 'react-router-dom';
import { toPng } from 'html-to-image';
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
import { formatHp, formatHpUnits, formatHpJoEok, formatShortDateTime, formatDurationShort } from '../../lib/format';
import { makeIdentity } from '../../lib/identity';
import './Settlement.css';

const ELEMENT_ICON = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };
const ROLE_RANK = { admin: 0, sub_admin: 1, member: 2 };

// 스쿼드 니케 아이콘 크기 설정 범위(px)
const AVATAR_PX_KEY = 'nikke_settlement_avatar_px';
const AVATAR_PX_MIN = 20;
const AVATAR_PX_MAX = 72;
const AVATAR_PX_DEFAULT = 32;

// 길드 보스전(하드)는 UTC+9 05:00 정각에 열린다. KST는 서머타임이 없어 고정 오프셋으로 계산한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const BOSS_BATTLE_OPEN_HOUR_KST = 5;

// 주어진 시각이 속한 '보스전 오픈(KST 05:00)' 시점을 epoch(ms)로 돌려준다.
// 1단계 소요 시간의 기준점 — 하드 오픈일은 첫 타수가 찍힌 날이므로 그 날의 05:00 KST를 쓴다.
// (raid_seasons.start_date 는 노말 난이도 시작일이라 하드 기준과 어긋난다.)
function bossBattleOpenAtKst(ts) {
  if (ts == null) return null;
  const kstWall = new Date(ts + KST_OFFSET_MS); // UTC 게터로 읽으면 KST 벽시계가 된다
  let open = Date.UTC(kstWall.getUTCFullYear(), kstWall.getUTCMonth(), kstWall.getUTCDate(), BOSS_BATTLE_OPEN_HOUR_KST) - KST_OFFSET_MS;
  if (open > ts) open -= 24 * 60 * 60 * 1000; // 05:00 이전 기록이면 전날 오픈분
  return open;
}

// 이미지 저장 시 CORS로 못 불러온 외부 이미지를 대체할 투명 1x1 PNG (RGBA 0,0,0,0 — 검증됨).
// (이전 값은 '투명'이라 적혀 있었지만 실제로는 불투명 검정 픽셀이라 실패한 아이콘이 검은 칸으로 찍혔다.)
const TRANSPARENT_PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// CORS 헤더를 주지 않아 캔버스에 못 담기는 외부 호스트 → 이미지 저장 시 Supabase 이미지 프록시로 우회.
// (sg-tools-cdn.blablalink.com / static.wikia.nocookie.net 은 CORS 허용이라 프록시 불필요)
const PROXY_IMAGE_HOSTS = ['www.blablalink.com'];
const IMAGE_PROXY_ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/image-proxy`;

// 프록시가 필요한 호스트면 프록시 URL을, 아니면 null 을 반환한다.
function toProxiedSrc(src) {
  try {
    const u = new URL(src, window.location.href);
    if (PROXY_IMAGE_HOSTS.includes(u.hostname) && import.meta.env.VITE_SUPABASE_URL) {
      return `${IMAGE_PROXY_ENDPOINT}?url=${encodeURIComponent(u.toString())}`;
    }
  } catch { /* ignore */ }
  return null;
}

// ---- 이미지 저장용 사전 인라인 ----
// html-to-image 는 <img> 노드마다 따로 fetch 한다. 결산표엔 같은 아이콘(코너 아이콘·속성 아이콘·니케 얼굴)이
// 수백~수천 번 반복되는데, 라이브러리 캐시는 '응답이 끝난 뒤'에야 채워져 동시에 출발한 같은 URL 요청을
// 하나로 묶지 못하고, cacheBust 로 매번 다른 URL이 되어 브라우저 캐시도 못 탄다. 그 결과 요청이 폭주해
// 일부가 실패하고 빈(검은) 칸으로 찍혔다. 실패 결과는 라이브러리 모듈 캐시에 남아 다음 저장에도 빠졌다.
// → 캡처 전에 '고유 URL'만 동시성 제한 + 재시도로 직접 받아 data URL 로 바꿔 둔다.
//    html-to-image 는 data URL 을 다시 받지 않으므로 네트워크 폭주와 캐시 오염이 모두 사라진다.
const INLINE_CONCURRENCY = 6;
const INLINE_RETRIES = 3;
const inlinedImageCache = new Map(); // 원본 URL → data URL (성공한 것만, 세션 내 재사용)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// CORS 미허용 호스트(www.blablalink.com)의 게임 아이콘은 public/game-icons/ 에 같은 파일명으로
// 미러링해 두었다(속성·무기 아이콘). 같은 출처라 CORS 없이 캔버스에 담긴다.
// 미러에 없는 파일이면 SPA 폴백(index.html, text/html)이 돌아오므로 이미지 타입 검사에서 걸러져 다음 후보로 넘어간다.
function toMirroredSrc(src) {
  try {
    const u = new URL(src, window.location.href);
    if (PROXY_IMAGE_HOSTS.includes(u.hostname)) {
      return `/game-icons/${u.pathname.split('/').pop()}`;
    }
  } catch { /* ignore */ }
  return null;
}

// 후보 URL(로컬 미러 → 이미지 프록시 → 원본)을 차례로 시도한다.
async function fetchImageAsDataUrl(src) {
  const candidates = [toMirroredSrc(src), toProxiedSrc(src), src].filter(Boolean);
  let lastErr;
  for (const url of candidates) {
    try {
      return await fetchUrlAsDataUrl(url);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function fetchUrlAsDataUrl(url) {
  let lastErr;
  for (let attempt = 0; attempt < INLINE_RETRIES; attempt++) {
    try {
      // 'reload': 페이지 <img>가 남긴 CORS 헤더 없는 캐시 응답을 재사용하지 않고 새 CORS 요청을 보낸다.
      const res = await fetch(url, { mode: 'cors', cache: 'reload' });
      // 4xx / 이미지 아님은 재시도해도 같으므로 바로 다음 후보로 넘긴다(재시도는 네트워크·5xx만).
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { permanent: res.status < 500 });
      const blob = await res.blob();
      if (blob.type && !blob.type.startsWith('image/')) {
        throw Object.assign(new Error(`not an image: ${blob.type}`), { permanent: true });
      }
      const dataUrl = await blobToDataUrl(blob);
      // 실제로 디코딩 가능한 이미지인지 확인(깨진 응답이 검은/빈 칸으로 찍히는 것 방지)
      const probe = new Image();
      probe.src = dataUrl;
      await probe.decode();
      return dataUrl;
    } catch (err) {
      lastErr = err;
      if (err.permanent) break;
      if (attempt < INLINE_RETRIES - 1) await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

// node 안의 모든 외부 <img>를 data URL 로 교체한다. 원복 함수와 실패한 URL 목록을 돌려준다.
async function inlineImagesForCapture(node) {
  const bySrc = new Map();
  node.querySelectorAll('img').forEach((img) => {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith('data:')) return;
    if (!bySrc.has(src)) bySrc.set(src, []);
    bySrc.get(src).push(img);
  });

  const queue = Array.from(bySrc.keys());
  const failed = [];
  const worker = async () => {
    while (queue.length) {
      const src = queue.shift();
      if (inlinedImageCache.has(src)) continue;
      try {
        inlinedImageCache.set(src, await fetchImageAsDataUrl(src));
      } catch (err) {
        failed.push(src);
        console.warn('이미지 인라인 실패:', src, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(INLINE_CONCURRENCY, queue.length) }, worker));

  const restore = [];
  const loads = [];
  bySrc.forEach((list, src) => {
    const dataUrl = inlinedImageCache.get(src) || TRANSPARENT_PX;
    list.forEach((img) => {
      restore.push([img, img.getAttribute('src'), img.getAttribute('srcset')]);
      img.removeAttribute('srcset');
      img.src = dataUrl;
      loads.push(img.decode().catch(() => {}));
    });
  });
  await Promise.all(loads);

  return {
    failed,
    restore: () => restore.forEach(([img, src, srcset]) => {
      if (src == null) img.removeAttribute('src'); else img.setAttribute('src', src);
      if (srcset != null) img.setAttribute('srcset', srcset);
    }),
  };
}

// 기본(정렬 미적용) 로스터 순서: 직책(길드장→부→원) → 가입순 → 수기 외부인은 맨 뒤(이름순)
function defaultRosterCompare(a, b) {
  if (a.isManual !== b.isManual) return a.isManual ? 1 : -1;
  if (a.isManual) return (a.name || '').localeCompare(b.name || '');
  const r = (ROLE_RANK[a.role] ?? 99) - (ROLE_RANK[b.role] ?? 99);
  if (r !== 0) return r;
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}

// 정렬 컬럼 접근자(파생 컬럼). useTableSort는 빈 값을 항상 맨 아래로 보낸다.
const SORT_ACCESSORS = {
  name: (r) => r.name || '',
  synchro: (r) => (r.synchro ?? ''),
  participation: (r) => r.participation,
  totalDmg: (r) => r.totalDmg,
  rank: (r) => r.rank,
  lastHits: (r) => r.lastHits,
  participationRate: (r) => r.participation, // 참여율은 참여수와 동일 정렬
  prevLevel: (r) => (r.prevLevel ?? ''),
  growth: (r) => (r.growth ?? ''),
  growthRank: (r) => (r.growthRank ?? ''),
};

// 완료(실전) 타수 목록에서 "가장 최근 실전 기록"의 싱크로를 구한다.
// 완료 시각(completed_at) 기준으로 가장 늦은 기록을 고르되, 그 기록의 싱크로가 비어있으면
// 그 다음으로 최근인, 싱크로가 채워진 실전 기록을 사용한다. (막타 기록의 싱크로가 비어도
// 프로필/모의전 값이 아니라 실제 실전 기록 값이 반영되도록)
function latestHitSynchro(hits) {
  if (!hits || hits.length === 0) return null;
  let best = null; // { t, v }
  for (const h of hits) {
    if (h?.synchro_level == null) continue;
    const t = String(h.completed_at || '');
    if (best === null || t >= best.t) best = { t, v: Number(h.synchro_level) };
  }
  return best ? best.v : null;
}

// 닉네임+싱크로 기준으로 병합한 결산 행을 만든다. rows(렌더용 useMemo)와 handleFinalize(확정
// 직전 재조회한 최신 데이터로 재계산) 양쪽에서 재사용해, "확정" 시점에도 동일한 규칙이 적용되게 한다.
function buildSettlementRows(members, battles, snapshot, prevSynchroByKey, noteEdits, prevEdits, synchroEdits, isFinalized) {
  const identity = makeIdentity(members);
  const map = {}; // 그룹 키(identityKey) → 행
  // 멤버 로스터로 초기화
  members.forEach(m => {
    const gkey = identity.memberIdentityKey(m);
    if (map[gkey]) return; // 동일 닉네임+싱크로 멤버 중복 방지
    const u = Array.isArray(m.users) ? m.users[0] : m.users;
    map[gkey] = {
      key: gkey, member_key: `user:${m.user_id}`, user_id: m.user_id, manual_nickname: null,
      name: m.in_game_name || '(이름없음)', isManual: false, role: m.role, createdAt: m.created_at,
      currentSynchro: u?.synchro_level != null ? Number(u.synchro_level) : null,
      hits: [], totalDmg: 0, lastHits: 0,
    };
  });
  // 타수 집계 (매칭되는 멤버가 없는 순수 수기/탈퇴 기록만 별도 행)
  battles.forEach(b => {
    const gkey = identity.identityKey(b);
    if (!map[gkey]) {
      const isManual = !!b.is_admin_written;
      const mkey = isManual ? `manual:${b.manual_nickname}` : `user:${b.user_id}`;
      // 탈퇴 등으로 로스터에 없으면 결산 스냅샷의 닉네임(display_name)으로 폴백해 닉네임을 영구 보존한다.
      map[gkey] = {
        key: gkey, member_key: mkey,
        user_id: isManual ? null : b.user_id,
        manual_nickname: isManual ? b.manual_nickname : null,
        name: identity.nameOf(b) || snapshot[mkey]?.display_name || (isManual ? (b.manual_nickname || '수기') : '알 수 없음'),
        isManual, role: 'member', createdAt: null,
        currentSynchro: b.synchro_level != null ? Number(b.synchro_level) : null,
        hits: [], totalDmg: 0, lastHits: 0,
      };
    }
    map[gkey].hits.push(b);
    map[gkey].totalDmg += Number(b.real_damage || 0);
    if (b.is_last_hit) map[gkey].lastHits += 1;
  });

  let list = Object.values(map);
  // 파생값
  list.forEach(r => {
    r.participation = r.hits.length;
    r.participationRate = Math.round((r.hits.length / 3) * 100);
    // 현재(라이브) 싱크로: 막타 시점 → 현재 프로필값 순. (재)확정 시 이 값을 스냅샷에 반영한다.
    r.liveSynchro = latestHitSynchro(r.hits) ?? r.currentSynchro ?? null;
    // 표시/성장 계산용 싱크로: 확정 상태면 얼린 스냅샷, 아니면 라이브 값.
    const snap = snapshot[r.member_key];
    r.synchroBase = (isFinalized && snap?.synchro_level != null) ? Number(snap.synchro_level) : r.liveSynchro;
    // 관리자 수기 수정(synchro_override)이 있으면 파생값보다 우선한다. 유저가 레벨을 갱신하지
    // 않고 시즌이 넘어가 값이 틀어진 경우를 결산 화면에서 바로 바로잡기 위한 값.
    const synchroEdit = synchroEdits[r.member_key];
    let manualSynchro = null;
    if (synchroEdit !== undefined) manualSynchro = synchroEdit === '' ? null : Number(synchroEdit);
    else if (snap?.synchro_override != null) manualSynchro = Number(snap.synchro_override);
    r.synchroOverride = (manualSynchro != null && Number.isFinite(manualSynchro)) ? manualSynchro : null;
    r.synchro = r.synchroOverride ?? r.synchroBase;
    // 지난 레벨: 직전 시즌 파생값이 기본, 관리자가 수기 입력하면 그 값으로 덮어쓴다.
    r.prevLevelBase = prevSynchroByKey[r.member_key] ?? null;
    const prevEdit = prevEdits[r.member_key];
    let manualPrev = null;
    if (prevEdit !== undefined) manualPrev = prevEdit === '' ? null : Number(prevEdit);
    else if (snap?.prev_synchro_level != null) manualPrev = Number(snap.prev_synchro_level);
    r.prevLevel = (manualPrev != null && Number.isFinite(manualPrev)) ? manualPrev : r.prevLevelBase;
    r.growth = (r.synchro != null && r.prevLevel != null) ? r.synchro - r.prevLevel : null;
    r.note = noteEdits[r.member_key] ?? (snap?.note || '');
  });

  // 기본 로스터 순서 → 순번(seq) 고정 부여
  list.sort(defaultRosterCompare);
  list.forEach((r, i) => { r.seq = i + 1; });

  // 대미지 순위 (총합 desc)
  [...list].sort((a, b) => b.totalDmg - a.totalDmg).forEach((r, i) => { r.rank = i + 1; });
  // 성장 랭킹 (증가량 desc; 값 있는 행만)
  const withGrowth = list.filter(r => r.growth != null).sort((a, b) => b.growth - a.growth);
  withGrowth.forEach((r, i) => { r.growthRank = i + 1; });
  list.forEach(r => { if (r.growth == null) r.growthRank = null; });

  return list;
}

export default function Settlement() {
  const { guild, role, user, leftCollapsed, rightCollapsed, isNarrow } = useOutletContext();
  const demo = useDemo();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const admin = isManager(role);
  const { gameIcons } = useGameData();
  const elementIconUrl = (element) =>
    gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;

  const { hpMode, setHpMode, showSquad, setShowSquad } = usePreferences();
  const { seasons, selectedSeason, setSelectedSeason, seasonsReady } = useBossBattleSeasons(guild?.id);

  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);        // union_members (id, user_id, in_game_name, role, created_at, users.synchro_level)
  const [battles, setBattles] = useState([]);        // 이번 시즌 완료 타수 (+bossInfo)
  const [statuses, setStatuses] = useState([]);      // 이번 시즌 보스 상태(단계/클리어) — 보스 개요표용
  const [isFinalized, setIsFinalized] = useState(false);
  const [snapshot, setSnapshot] = useState({});      // member_key -> { synchro_level, note }
  const [prevSynchroByKey, setPrevSynchroByKey] = useState({}); // member_key -> 지난 시즌 싱크로
  const [noteEdits, setNoteEdits] = useState({});    // member_key -> note (편집 로컬 상태)
  const [prevEdits, setPrevEdits] = useState({});    // member_key -> 지난 레벨 수기 입력값(문자열)
  const [synchroEdits, setSynchroEdits] = useState({}); // member_key -> 싱크로 수기 입력값(문자열)
  const [finalizing, setFinalizing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  // 스쿼드 니케 아이콘 크기(px). 열 폭은 내용에 맞춰 자동으로 늘어난다. localStorage 유지.
  const [avatarPx, setAvatarPxState] = useState(() => {
    try {
      const v = Number(localStorage.getItem(AVATAR_PX_KEY));
      if (v >= AVATAR_PX_MIN && v <= AVATAR_PX_MAX) return v;
    } catch { /* ignore */ }
    return AVATAR_PX_DEFAULT;
  });
  const setAvatarPx = (v) => {
    setAvatarPxState(v);
    try { localStorage.setItem(AVATAR_PX_KEY, String(v)); } catch { /* ignore */ }
  };
  // 이미지로 저장할 결산표 영역(보스 개요 + 멤버 표)
  const captureRef = useRef(null);

  // 쿼리파라미터 season 을 최초 1회 반영
  useEffect(() => {
    const qs = searchParams.get('season');
    if (seasonsReady && qs && seasons.some(s => s.name === qs) && qs !== selectedSeason) {
      setSelectedSeason(qs);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonsReady]);

  useEffect(() => {
    if (seasonsReady && seasons.length === 0) setLoading(false);
  }, [seasonsReady, seasons.length]);

  // 멤버 로스터 + 이번 시즌 완료 타수만 다시 조회한다. fetchAll(최초 로드)과 handleFinalize(확정
  // 직전 최신화)가 공유해, "확정" 버튼을 눌렀을 때 페이지를 연 시점의 오래된 렌더 상태가 아니라
  // 그 순간의 실제 최신 완료 기록을 기준으로 스냅샷을 만들도록 한다.
  const fetchMembersAndBattles = useCallback(async () => {
    const memPromise = supabase
      .from('union_members')
      .select('id, user_id, in_game_name, role, created_at, users(synchro_level)')
      .eq('union_id', guild.id)
      .eq('join_status', 'approved');

    const { data: statuses, error: sErr } = await supabase
      .from('union_raid_status')
      .select('id, stage_level, is_cleared, cleared_at, global_raid_bosses!inner ( boss_number, name, element, boss_grade, season_name, image_url, image_alt )')
      .eq('union_id', guild.id)
      .eq('global_raid_bosses.season_name', selectedSeason);
    if (sErr) throw sErr;
    const statusIds = (statuses || []).map(s => s.id);
    const bossInfoMap = {};
    (statuses || []).forEach(s => { bossInfoMap[s.id] = { ...s.global_raid_bosses, stage_level: s.stage_level }; });

    const battlesPromise = statusIds.length
      ? supabase.from('mock_battles').select('*').eq('union_id', guild.id).eq('status', 'completed')
          .in('boss_status_id', statusIds).order('completed_at', { ascending: true })
      : Promise.resolve({ data: [] });

    const [memRes, bRes] = await Promise.all([memPromise, battlesPromise]);
    if (memRes.error) throw memRes.error;
    if (bRes.error) throw bRes.error;

    const battles = (bRes.data || []).map(b => ({ ...b, bossInfo: bossInfoMap[b.boss_status_id] }));
    return { members: memRes.data || [], battles, statuses: statuses || [] };
  }, [guild?.id, selectedSeason]);

  const fetchAll = useCallback(async () => {
    if (!selectedSeason || !guild?.id || demo.isDemo) return;
    setLoading(true);
    try {
      const [{ members, battles, statuses }, statusRowRes, snapRes] = await Promise.all([
        fetchMembersAndBattles(),
        supabase.from('union_settlement_status')
          .select('is_finalized').eq('union_id', guild.id).eq('season_name', selectedSeason).maybeSingle(),
        supabase.from('union_settlement_members')
          .select('member_key, synchro_level, synchro_override, note, prev_synchro_level, display_name').eq('union_id', guild.id).eq('season_name', selectedSeason),
      ]);

      const snapMap = {};
      (snapRes.data || []).forEach(r => { snapMap[r.member_key] = { synchro_level: r.synchro_level, synchro_override: r.synchro_override, note: r.note, prev_synchro_level: r.prev_synchro_level, display_name: r.display_name }; });

      setMembers(members);
      setBattles(battles);
      setStatuses(statuses);
      setIsFinalized(!!statusRowRes.data?.is_finalized);
      setSnapshot(snapMap);
      setNoteEdits(Object.fromEntries(Object.entries(snapMap).map(([k, v]) => [k, v.note || ''])));
      setPrevEdits(Object.fromEntries(Object.entries(snapMap)
        .filter(([, v]) => v.prev_synchro_level != null)
        .map(([k, v]) => [k, String(v.prev_synchro_level)])));
      setSynchroEdits(Object.fromEntries(Object.entries(snapMap)
        .filter(([, v]) => v.synchro_override != null)
        .map(([k, v]) => [k, String(v.synchro_override)])));

      // 지난 시즌 싱크로 (성장 계산용) — 관리자 열에서만 사용
      await fetchPrevSynchro();
    } catch (err) {
      console.error('결산 데이터 로드 실패:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason, guild?.id, demo.isDemo, fetchMembersAndBattles]);

  // 직전 시즌(현재 시즌 바로 이전, 데이터 있는 시즌) 싱크로: 확정 스냅샷 우선, 없으면 완료 타수에서 파생
  const fetchPrevSynchro = async () => {
    setPrevSynchroByKey({});
    const idx = seasons.findIndex(s => s.name === selectedSeason);
    const prev = idx >= 0 && idx < seasons.length - 1 ? seasons[idx + 1] : null;
    if (!prev) return;
    try {
      const { data: snap } = await supabase.from('union_settlement_members')
        .select('member_key, synchro_level').eq('union_id', guild.id).eq('season_name', prev.name);
      const map = {};
      if (snap && snap.length) {
        snap.forEach(r => { if (r.synchro_level != null) map[r.member_key] = Number(r.synchro_level); });
      } else {
        // 스냅샷이 없으면 직전 시즌 완료 타수의 막타 시점 싱크로로 파생
        const { data: pStatuses } = await supabase
          .from('union_raid_status')
          .select('id, global_raid_bosses!inner ( season_name )')
          .eq('union_id', guild.id).eq('global_raid_bosses.season_name', prev.name);
        const pIds = (pStatuses || []).map(s => s.id);
        if (pIds.length) {
          const { data: pB } = await supabase.from('mock_battles')
            .select('user_id, is_admin_written, manual_nickname, synchro_level, completed_at')
            .eq('union_id', guild.id).eq('status', 'completed').in('boss_status_id', pIds)
            .order('completed_at', { ascending: true });
          (pB || []).forEach(b => {
            const key = b.is_admin_written ? `manual:${b.manual_nickname}` : `user:${b.user_id}`;
            if (b.synchro_level != null) map[key] = Number(b.synchro_level); // 마지막(최근) 값이 남음
          });
        }
      }
      setPrevSynchroByKey(map);
    } catch (err) {
      console.error('지난 시즌 싱크로 로드 실패:', err);
    }
  };

  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]);

  // ---- 행 구성 ----
  // 닉네임+싱크로 기준으로 병합한다. 본인 작성과 관리자 수기 기록이라도 닉네임/싱크로가 같으면
  // 동일 인물(멤버)로 합쳐진다. member_key(비고/스냅샷 저장 키)는 실멤버 user:<id> /
  // 매칭 안 되는 순수 외부 수기 manual:<닉네임> 규칙을 유지한다(지휘 현황판과 동일).
  const rows = useMemo(
    () => buildSettlementRows(members, battles, snapshot, prevSynchroByKey, noteEdits, prevEdits, synchroEdits, isFinalized),
    [members, battles, snapshot, prevSynchroByKey, noteEdits, prevEdits, synchroEdits, isFinalized]
  );

  const sort = useTableSort(rows, { accessors: SORT_ACCESSORS });

  // 보스 개요(상단 5칸): 보스별 클리어 난이도 + 누적 대미지, 길드 총 대미지
  const bossOverview = useMemo(() => {
    const byNum = {};
    statuses.forEach(s => {
      const b = s.global_raid_bosses;
      const n = b?.boss_number;
      if (!n) return;
      if (!byNum[n]) byNum[n] = { boss_number: n, name: b.name, element: b.element, boss_grade: b.boss_grade, image_url: b.image_url, image_alt: b.image_alt, clearedMax: 0, totalDmg: 0 };
      if (s.is_cleared && s.stage_level > byNum[n].clearedMax) byNum[n].clearedMax = s.stage_level;
    });
    battles.forEach(b => {
      const n = b.bossInfo?.boss_number;
      if (n && byNum[n]) byNum[n].totalDmg += Number(b.real_damage || 0);
    });
    // 4단계(무한) = 5번 보스의 특수 최종 단계(일반 최대 단계 + 1). 진행한 경우 별도 합산해 표시한다.
    const maxStageNormal = Math.max(0, ...statuses
      .filter(s => s.global_raid_bosses?.boss_number !== 5)
      .map(s => s.stage_level));
    const infiniteStage = Math.max(0, ...statuses
      .filter(s => s.global_raid_bosses?.boss_number === 5)
      .map(s => s.stage_level));
    const hasInfinite = infiniteStage > maxStageNormal;
    let stage4Total = 0;
    if (hasInfinite) {
      battles.forEach(b => {
        if (b.bossInfo?.boss_number === 5 && b.bossInfo?.stage_level === infiniteStage) {
          stage4Total += Number(b.real_damage || 0);
        }
      });
    }
    const list = [1, 2, 3, 4, 5].map(n => byNum[n]).filter(Boolean);
    const guildTotal = list.reduce((sum, x) => sum + x.totalDmg, 0);
    return { list, guildTotal, stage4Total };
  }, [statuses, battles]);

  // 단계별 클리어 타임: 그 단계 5마리를 모두 잡은 시각(= 마지막 보스의 클리어 시각)을 단계 클리어로 본다.
  // 무한 단계(5번 보스만 있는 최종 단계)는 클리어 개념이 없어 마지막 타수 소모 시각으로 대신한다.
  // 소요 시간은 직전 단계 클리어 시각 대비(1단계는 시즌 첫 타수 시각 대비)로 계산한다.
  const stageClears = useMemo(() => {
    if (statuses.length === 0) return [];
    const byStage = {};
    statuses.forEach(s => {
      const lv = s.stage_level;
      if (!byStage[lv]) byStage[lv] = { level: lv, total: 0, cleared: 0, lastAt: null, isInfinite: false };
      const g = byStage[lv];
      g.total += 1;
      if (s.is_cleared) {
        g.cleared += 1;
        const t = s.cleared_at ? new Date(s.cleared_at).getTime() : null;
        if (t && (g.lastAt == null || t > g.lastAt)) g.lastAt = t;
      }
    });
    // 단계 전체를 잡지 못했으면 '진행 중'으로 두고 시각을 비운다.
    Object.values(byStage).forEach(g => { if (g.cleared < g.total) g.lastAt = null; });

    const maxStageNormal = Math.max(0, ...statuses
      .filter(s => s.global_raid_bosses?.boss_number !== 5)
      .map(s => s.stage_level));
    const hitTimeOf = (b) => (b.completed_at ? new Date(b.completed_at).getTime() : null);
    Object.values(byStage).forEach(g => {
      if (g.level <= maxStageNormal) return;
      g.isInfinite = true;
      g.hitCount = 0;
      let last = null;
      battles.forEach(b => {
        if (b.bossInfo?.stage_level !== g.level) return;
        g.hitCount += 1;
        const t = hitTimeOf(b);
        if (t && (last == null || t > last)) last = t;
      });
      g.lastAt = last;
    });

    const list = Object.values(byStage)
      .sort((a, b) => a.level - b.level)
      .filter(g => !g.isInfinite || g.hitCount > 0); // 진입도 안 한 무한 단계는 숨김

    // 1단계 소요 시간의 기준점: 첫 타수가 찍힌 날(=하드 오픈일)의 KST 05:00.
    const firstHitAt = battles.reduce((min, b) => {
      const t = hitTimeOf(b);
      return t && (min == null || t < min) ? t : min;
    }, null);
    let base = bossBattleOpenAtKst(firstHitAt);
    list.forEach(g => {
      g.duration = (g.lastAt != null && base != null && g.lastAt > base) ? g.lastAt - base : null;
      if (g.lastAt != null) base = g.lastAt;
    });
    return list;
  }, [statuses, battles]);

  // 길드 총 대미지 / 4단계 대미지 표기: 간단 → 조·억·만 단위, 상세 → 천단위 콤마.
  const fmtTotal = (v) => (hpMode === 'simple' ? formatHpUnits(v) : Number(v || 0).toLocaleString());
  // 보스별 누적 대미지: 간단 모드에서도 조 단위를 살려 "1조 9217.3억"으로 표기한다.
  const fmtBossDmg = (v) => (hpMode === 'simple' ? formatHpJoEok(v) : Number(v || 0).toLocaleString());

  // ---- 결산표 이미지로 저장 ----
  // mode: 'public' = 일반 유저가 보는 범위만(관리자 전용 결과/성장 열 제외), 'full' = 성장까지 전체
  const handleSaveImage = async (mode = 'full') => {
    if (!admin) return; // 이미지 생성은 관리자 전용
    const node = captureRef.current;
    if (!node || exporting) return;
    setExporting(true);
    // 공개용: 관리자 전용 열(결과/성장 그룹)을 캡처 동안만 숨긴다.
    const adminCells = mode === 'public' ? Array.from(node.querySelectorAll('.settlement-admin-col')) : [];
    adminCells.forEach((el) => { el.dataset.prevDisplay = el.style.display; el.style.display = 'none'; });
    // 가로 스크롤로 잘리는 열까지 모두 담기 위해, 캡처 동안만 표 래퍼를 전체 폭으로 펼친다.
    // 폭은 반드시 '픽셀'로 고정한다 — max-content 로 두면 보스 개요표(width:100% + table-layout:fixed +
    // colspan 헤더)가 비정상적으로 커져(수백만 px) 이미지가 얇은 가로줄로 깨진다.
    const wrap = node.querySelector('.settlement-table-wrap');
    const prev = wrap ? { overflow: wrap.style.overflow, width: wrap.style.width } : null;
    const prevNodeWidth = node.style.width;
    const fullW = wrap ? Math.max(wrap.scrollWidth, wrap.clientWidth) : node.scrollWidth;
    if (wrap) { wrap.style.overflow = 'visible'; wrap.style.width = `${fullW}px`; }
    node.style.width = `${fullW}px`;
    let inlined = null;
    try {
      // 외부 이미지를 고유 URL 단위로 미리 받아 data URL 로 교체(캡처 동안만, 끝나면 원복).
      // CORS 미허용 호스트는 이 단계에서 이미지 프록시를 거친다.
      inlined = await inlineImagesForCapture(node);
      const bg = getComputedStyle(document.body).getPropertyValue('--surface-3').trim() || '#0f172a';
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: bg,
        width: node.scrollWidth,
        height: node.scrollHeight,
        // CORS 헤더를 주는 외부 CDN(예: sg-tools-cdn.blablalink.com, static.wikia.nocookie.net)이라도
        // 페이지가 이미 <img>로 불러와 캐시된 'CORS 없는' 응답을 재사용하면 실패한다.
        // cacheBust로 URL에 타임스탬프를 붙여 새 CORS 요청을 강제하면 이 이미지들이 정상 포함된다.
        cacheBust: true,
        // 그래도 CORS를 아예 안 주는 호스트(예: www.blablalink.com)는 불러오지 못하므로,
        // 전체 저장이 실패하지 않도록 해당 이미지만 투명 픽셀로 대체한다.
        imagePlaceholder: TRANSPARENT_PX,
        // 이미지 로드 오류가 나도 캡처를 계속 진행한다(전체 실패 방지 이중 안전장치).
        onImageErrorHandler: () => {},
      });
      const a = document.createElement('a');
      a.download = `결산_${selectedSeason || 'season'}${mode === 'public' ? '_공개' : ''}.png`;
      a.href = dataUrl;
      a.click();
    } catch (err) {
      console.error('이미지 저장 실패:', err);
      alert('이미지 저장에 실패했습니다.');
    } finally {
      adminCells.forEach((el) => { el.style.display = el.dataset.prevDisplay || ''; delete el.dataset.prevDisplay; });
      inlined?.restore();
      if (wrap && prev) { wrap.style.overflow = prev.overflow; wrap.style.width = prev.width; }
      node.style.width = prevNodeWidth;
      setExporting(false);
    }
  };

  // ---- 결산 확정 (스냅샷) ----
  const handleFinalize = async () => {
    if (!admin) return;
    if (!window.confirm('현재 싱크로 레벨을 스냅샷으로 확정합니다.\n확정 후 싱크로 값은 고정되고, 일반 유저도 공개 항목을 열람할 수 있습니다.\n계속할까요?')) return;
    setFinalizing(true);
    try {
      // 확정 직전에 멤버/완료 타수를 다시 조회해 최신 값으로 스냅샷을 만든다. 이 페이지를 열어둔
      // 채로 다른 화면에서 새 실전 기록이 등록되면 화면의 rows(마운트 시점 상태)가 갱신되지
      // 않은 채로 남아있어, 그대로 얼리면 방금 등록된 최신 기록이 반영되지 않는 문제가 있었다.
      const fresh = await fetchMembersAndBattles();
      const freshRows = buildSettlementRows(fresh.members, fresh.battles, snapshot, prevSynchroByKey, noteEdits, prevEdits, synchroEdits, isFinalized);
      const payload = freshRows.map(r => {
        // 수기 지난 레벨 override 값만 보존한다(파생 기본값은 저장하지 않음).
        const prevRaw = prevEdits[r.member_key];
        const manualPrev = prevRaw !== undefined
          ? (prevRaw === '' ? null : Math.trunc(Number(prevRaw)))
          : (snapshot[r.member_key]?.prev_synchro_level ?? null);
        return {
          union_id: guild.id, season_name: selectedSeason, member_key: r.member_key,
          user_id: r.user_id, manual_nickname: r.manual_nickname,
          // 관리자가 수기로 고친 싱크로는 재확정에서도 파생값으로 덮이지 않는다.
          synchro_override: r.synchroOverride,
          synchro_level: r.synchroOverride ?? r.liveSynchro, note: r.note || null,
          // 닉네임 스냅샷(탈퇴 후에도 영구 보존)
          display_name: r.name,
          prev_synchro_level: (manualPrev != null && Number.isFinite(manualPrev)) ? manualPrev : null,
          updated_at: new Date().toISOString(),
        };
      });
      const { error: mErr } = await supabase.from('union_settlement_members')
        .upsert(payload, { onConflict: 'union_id,season_name,member_key' });
      if (mErr) throw mErr;
      const { error: stErr } = await supabase.from('union_settlement_status').upsert({
        union_id: guild.id, season_name: selectedSeason, is_finalized: true,
        finalized_at: new Date().toISOString(), finalized_by: user?.id, updated_at: new Date().toISOString(),
      }, { onConflict: 'union_id,season_name' });
      if (stErr) throw stErr;
      setRefreshKey(k => k + 1);
      alert('결산이 확정되었습니다.');
    } catch (err) {
      console.error('결산 확정 실패:', err);
      alert('결산 확정에 실패했습니다.');
    } finally {
      setFinalizing(false);
    }
  };

  // ---- 게이팅 ----
  if (demo.isDemo) {
    return <div className="settlement-page"><p>체험 모드에서는 결산을 사용할 수 없습니다.</p>
      <button onClick={() => navigate(-1)} style={btnStyle}>돌아가기</button></div>;
  }
  if (loading && seasons.length === 0) {
    return <div className="settlement-page">데이터를 불러오는 중...</div>;
  }
  if (seasonsReady && seasons.length === 0) {
    return <div className="settlement-page">결산할 보스전 데이터가 없습니다.</div>;
  }
  if (!admin && !isFinalized) {
    return <div className="settlement-page">
      <p>보스전 진행 중에는 관리자만 결산을 열람할 수 있습니다.</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>결산이 확정되면 공개됩니다.</p>
      <button onClick={() => navigate(-1)} style={btnStyle}>돌아가기</button>
    </div>;
  }

  const colSpanTotal = 10 + (admin ? 6 : 0);

  return (
    <div className="settlement-page settlement-print-area"
      style={{ paddingLeft: leftCollapsed ? 'var(--panel-collapse-inset)' : undefined, paddingRight: rightCollapsed ? 'var(--panel-collapse-inset)' : undefined }}>
      <div className="settlement-controls settlement-no-print">
        <button onClick={() => navigate(-1)} style={btnStyle}>← 뒤로</button>
        <h2 style={{ margin: 0, color: 'var(--accent-green)', fontSize: isNarrow ? '1.1rem' : '1.4rem' }}>📋 길드 보스전 결산</h2>
        <select value={selectedSeason} onChange={(e) => setSelectedSeason(e.target.value)}
          style={{ padding: '6px', borderRadius: '4px', background: 'var(--surface-1)', color: 'var(--text-strong)', border: '1px solid var(--border-1)' }}>
          {seasons.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
        <span style={{ fontSize: '0.85rem', color: isFinalized ? 'var(--accent-green)' : 'var(--accent-amber)' }}>
          {isFinalized ? '● 확정됨' : '○ 미확정'}
        </span>
        <button onClick={() => setShowSquad(!showSquad)}
          style={{ ...btnStyle, marginLeft: 'auto' }}>{showSquad ? '스쿼드 숨기기' : '스쿼드 표시'}</button>
        {showSquad && (
          <label className="settlement-avatar-size" title="스쿼드 니케 아이콘 크기 (이미지 저장에도 그대로 반영)">
            아이콘
            <input type="range" min={AVATAR_PX_MIN} max={AVATAR_PX_MAX} step={2}
              value={avatarPx} onChange={(e) => setAvatarPx(Number(e.target.value))} />
            <span>{avatarPx}px</span>
          </label>
        )}
        <button onClick={() => setHpMode(hpMode === 'simple' ? 'detail' : 'simple')}
          style={{ ...btnStyle, background: hpMode === 'simple' ? '#3b82f6' : '#ef4444', color: '#fff', border: 'none' }}>
          {hpMode === 'simple' ? '간이 모드' : '상세 모드'}
        </button>
        {admin && (
          <>
            <button onClick={() => handleSaveImage('public')} disabled={exporting} style={btnStyle}
              title="일반 유저가 보는 범위만(참여수·성장 등 관리자 열 제외) 이미지로 저장">
              {exporting ? '저장 중...' : '🖼 이미지(공개)'}
            </button>
            <button onClick={() => handleSaveImage('full')} disabled={exporting} style={btnStyle}
              title="성장 랭킹까지 모든 열을 이미지로 저장(관리자용)">
              {exporting ? '저장 중...' : '🖼 이미지(전체)'}
            </button>
          </>
        )}
        {admin && (
          <button onClick={handleFinalize} disabled={finalizing}
            style={{ ...btnStyle, background: 'var(--accent-green)', color: '#000', border: 'none', fontWeight: 'bold' }}>
            {finalizing ? '확정 중...' : (isFinalized ? '재확정(스냅샷 갱신)' : '결산 확정')}
          </button>
        )}
      </div>

      <div ref={captureRef} className="settlement-capture">
      {bossOverview.list.length > 0 && (
        <table className="settlement-boss-overview">
          <tbody>
            <tr>
              <td className="sbo-total" colSpan={5}>
                길드 총 대미지 <strong>{fmtTotal(bossOverview.guildTotal)}</strong>
                {bossOverview.stage4Total > 0 && (
                  <div className="sbo-total-sub">
                    4단계 가한 대미지 <strong>{fmtTotal(bossOverview.stage4Total)}</strong>
                  </div>
                )}
              </td>
            </tr>
            <tr>
              {bossOverview.list.map(b => (
                <td key={b.boss_number} className="sbo-cell"
                  onClick={() => navigate(`/workspace/settlement/boss/${b.boss_number}?season=${encodeURIComponent(selectedSeason || '')}`)}
                  title={`${b.name} 결산 보기`}>
                  <div className="sbo-icon">
                    <BossImage
                      url={b.image_url} alt={b.image_alt} element={b.element}
                      size={96} fit="cover" fade={0.1}
                      fallbackFit="contain" fallbackSize={40}
                      style={{ width: '100%', height: '100%', borderRadius: 0 }}
                    />
                  </div>
                  <div className="sbo-name">{b.name}</div>
                  <div className="sbo-meta">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}>
                      {b.element}
                      {elementIconUrl(b.element) && (
                        <img src={elementIconUrl(b.element)} alt={b.element} style={{ width: '1em', height: '1em', objectFit: 'contain' }} />
                      )}
                    </span>
                    {' · '}{b.clearedMax > 0 ? `${b.clearedMax}단계 클리어` : '미클리어'}
                  </div>
                  <div className="sbo-dmg">{fmtBossDmg(b.totalDmg)}</div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}

      {stageClears.length > 0 && (
        <div className="settlement-stage-times">
          <div className="sst-title">⏱ 단계별 클리어 타임</div>
          <div className="sst-list">
            {stageClears.map(g => (
              <div key={g.level} className="sst-item">
                <div className="sst-level">
                  {g.level}단계
                  {g.isInfinite && <span className="sst-tag">무한</span>}
                </div>
                <div className={`sst-time${g.lastAt == null ? ' sst-time-pending' : ''}`}>
                  {g.lastAt != null
                    ? formatShortDateTime(g.lastAt)
                    : `진행 중 (${g.cleared}/${g.total})`}
                </div>
                <div className="sst-sub">
                  {g.duration != null ? `소요 ${formatDurationShort(g.duration)}` : ' '}
                  {g.isInfinite && g.lastAt != null && ' · 마지막 타수'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="settlement-table-wrap">
        <table className="settlement-table">
          <thead>
            {/* 그룹 헤더 */}
            <tr>
              <th className="settlement-group-th" colSpan={3}></th>
              <th className="settlement-group-th" colSpan={2}>일자</th>
              <th className="settlement-group-th" colSpan={5}>대미지</th>
              {admin && <th className="settlement-group-th settlement-admin-col" colSpan={3}>결과</th>}
              {admin && <th className="settlement-group-th settlement-admin-col" colSpan={3}>성장</th>}
            </tr>
            <tr>
              <th>순번</th>
              <SortableTh field="name" sort={sort}>닉네임</SortableTh>
              <SortableTh field="synchro" sort={sort}>싱크로</SortableTh>
              <SortableTh field="participation" sort={sort}>참여</SortableTh>
              <th>비고</th>
              <th>1타</th>
              <th>2타</th>
              <th>3타</th>
              <SortableTh field="totalDmg" sort={sort}>총합</SortableTh>
              <SortableTh field="rank" sort={sort}>순위</SortableTh>
              {admin && <SortableTh field="participation" sort={sort} className="settlement-admin-col">참여 수</SortableTh>}
              {admin && <SortableTh field="participationRate" sort={sort} className="settlement-admin-col">참여율</SortableTh>}
              {admin && <SortableTh field="lastHits" sort={sort} className="settlement-admin-col">막타 수</SortableTh>}
              {admin && <SortableTh field="prevLevel" sort={sort} className="settlement-admin-col">지난 레벨</SortableTh>}
              {admin && <SortableTh field="growth" sort={sort} className="settlement-admin-col">증가량</SortableTh>}
              {admin && <SortableTh field="growthRank" sort={sort} className="settlement-admin-col">성장 랭킹</SortableTh>}
            </tr>
          </thead>
          <tbody>
            {sort.sorted.length === 0 ? (
              <tr><td colSpan={colSpanTotal} style={{ padding: '30px', color: 'var(--text-dim)' }}>결산 데이터가 없습니다.</td></tr>
            ) : sort.sorted.map(r => (
              <tr key={r.key}>
                <td style={{ color: 'var(--text-dim)' }}>{r.seq}</td>
                <td style={{ textAlign: 'left', fontWeight: 'bold' }}>
                  {r.name}
                  {r.isManual && <span style={{ marginLeft: 4, fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 'normal' }}>(수기)</span>}
                </td>
                <td>{r.synchro != null ? `Lv.${r.synchro}` : '-'}</td>
                <td style={{ fontWeight: 'bold', color: r.participation === 3 ? 'var(--accent-green)' : 'var(--text-strong)' }}>{r.participation} / 3</td>
                <td><div className="settlement-note-text">{r.note || '-'}</div></td>
                {[0, 1, 2].map(i => {
                  const hit = r.hits[i];
                  return (
                    <td key={i}>
                      {hit ? (
                        <div>
                          <div className="settlement-hit-title">
                            {hit.is_last_hit && <span className="settlement-badge-last">막타</span>}
                            <span>Lv.{hit.bossInfo?.stage_level} {hit.bossInfo?.name}</span>
                            {elementIconUrl(hit.bossInfo?.element) ? (
                              <img src={elementIconUrl(hit.bossInfo?.element)} alt={hit.bossInfo?.element} style={{ width: 15, height: 15, objectFit: 'contain' }} />
                            ) : (<span>{ELEMENT_ICON[hit.bossInfo?.element] || ''}</span>)}
                          </div>
                          {showSquad && (
                            <div className="settlement-hit-squad">
                              {[hit.slot_1_nikke_id, hit.slot_2_nikke_id, hit.slot_3_nikke_id, hit.slot_4_nikke_id, hit.slot_5_nikke_id].map((nid, k) => (
                                <NikkeAvatar key={k} nikkeId={nid} size={avatarPx} />
                              ))}
                            </div>
                          )}
                          <div style={{ fontWeight: 'bold' }}>{formatHp(hit.real_damage, hpMode)}</div>
                        </div>
                      ) : (<span style={{ color: 'var(--border-3)' }}>-</span>)}
                    </td>
                  );
                })}
                <td style={{ fontWeight: 'bold', color: 'var(--accent-green)' }}>{formatHp(r.totalDmg, hpMode)}</td>
                <td style={{ fontWeight: 'bold', color: r.rank <= 3 && r.totalDmg > 0 ? 'var(--accent-amber)' : 'var(--text-strong)' }}>{r.totalDmg > 0 ? r.rank : '-'}</td>
                {admin && <td className="settlement-admin-col">{r.participation}</td>}
                {admin && <td className="settlement-admin-col">{r.participationRate}%</td>}
                {admin && <td className="settlement-admin-col">{r.lastHits}</td>}
                {admin && <td className="settlement-admin-col">{r.prevLevel != null ? `Lv.${r.prevLevel}` : '-'}</td>}
                {admin && <td className="settlement-admin-col" style={{ color: r.growth > 0 ? 'var(--accent-green)' : r.growth < 0 ? 'var(--danger)' : 'var(--text-strong)' }}>
                  {r.growth != null ? (r.growth > 0 ? `+${r.growth}` : r.growth) : '-'}
                </td>}
                {admin && <td className="settlement-admin-col">{r.growthRank != null ? r.growthRank : '-'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}

const btnStyle = {
  background: 'transparent', border: '1px solid var(--border-3)', color: 'var(--text-soft)',
  padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem',
};
