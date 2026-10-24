import { supabase } from './supabase';

// 니케 선택 모달의 "자주 쓰인 니케" 정렬 점수를 가져온다.
//
// 실제 집계는 get_nikke_usage_ranking RPC 가 한다. (마이그레이션 주석에 설계 근거)
// 최근 시즌의 완료 모의전 덱에서 니케별 사용률을 뽑아, 최신 시즌일수록 큰 가중치를 곱해 더한 값.
//
// 이 기능은 정렬 '보조'다. 조회가 실패해도 모달은 열려야 하고 기존 이름순으로 동작해야 하므로
// 에러를 밖으로 던지지 않고 빈 결과를 돌려준다.

const CACHE_TTL_MS = 5 * 60 * 1000;

// key -> { at, promise }
// 모달은 열 때마다 새로 조회하는데, 같은 보스를 연달아 열면 같은 응답을 계속 받게 된다.
// 결과가 니케당 1행(=200행 미만)이라 메모리에 들고 있어도 부담이 없다.
const cache = new Map();

/**
 * @param {object}  opts
 * @param {?string} opts.bossName    이번에 편성 중인 보스 이름 (없으면 전체 보스 기준)
 * @param {?string} opts.element     그 보스의 속성. 보스명 표본이 얇을 때의 폴백 기준
 * @param {number}  opts.seasonCount 집계할 최근 시즌 수
 * @returns {Promise<{ scores: Map<number, number>, scope: ?string }>}
 *          scope: 'boss' | 'element' | 'all' — 실제로 집계에 쓰인 범위
 */
export function fetchNikkeUsage({ bossName = null, element = null, seasonCount = 3 } = {}) {
  const key = `${bossName || ''}|${element || ''}|${seasonCount}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;

  const promise = (async () => {
    const { data, error } = await supabase.rpc('get_nikke_usage_ranking', {
      p_boss_name: bossName,
      p_element: element,
      p_season_count: seasonCount,
    });
    if (error) throw error;

    const scores = new Map();
    (data || []).forEach(row => {
      const score = Number(row.score);
      if (Number.isFinite(score)) scores.set(row.nikke_id, score);
    });
    return { scores, scope: data?.[0]?.scope || null };
  })().catch(err => {
    // 실패는 캐싱하지 않는다. 다음에 모달을 열면 다시 시도한다.
    cache.delete(key);
    console.warn('니케 사용 통계 조회 실패:', err);
    return { scores: new Map(), scope: null };
  });

  cache.set(key, { at: Date.now(), promise });
  return promise;
}
