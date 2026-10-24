import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Anon Key is missing. Check your .env file.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '', {
  realtime: {
    // 하트비트를 Web Worker에서 실행 → 백그라운드 탭 타이머 스로틀링으로 인한 realtime 끊김 방지
    worker: true,
    heartbeatIntervalMs: 15000,
  },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ── 세션 게이트 ───────────────────────────────────────────────────────────
 *
 * supabase-js는 세션을 못 얻어도 요청을 막지 않고 **조용히 anon 키로** 보낸다.
 *
 *   SupabaseClient._getAccessToken()
 *     const { data } = await this.auth.getSession()
 *     return data.session?.access_token ?? this.supabaseKey   ← 폴백. error는 버려진다.
 *
 * 그렇게 나간 요청은 RLS의 `TO authenticated` 정책에 행이 전부 걸러져
 * `data: []` / `data: null` + `error: null`로 돌아온다.
 * 앱 입장에서는 "정상 응답인데 데이터가 없음"과 구분할 방법이 없다.
 * → 콘솔은 깨끗한데 화면만 비는 증상의 정체.
 *
 * 하필 **최초 접속**에서 터지는 이유:
 *  1. 탭을 닫아둔 사이 access token(기본 1시간)이 만료돼 있으면,
 *     그 페이지의 첫 쿼리는 refresh 왕복을 한 번 거쳐야 한다.
 *  2. 그 왕복이 네트워크 문제로 실패하면(첫 접속 = 콜드 커넥션이라 확률이 높다)
 *     auth-js는 세션을 지우지도 SIGNED_OUT을 쏘지도 않은 채
 *     getSession()에 `session: null`만 돌려준다. (retryable fetch error 경로)
 *  3. 게다가 그 실패를 refresh token 단위로 60초(REFRESH_FAILURE_COOLDOWN_MS)
 *     캐시하므로, 이후 호출은 네트워크를 다시 타지도 않고 실패를 재사용한다.
 *     → 그 페이지 로드 내내 모든 쿼리가 anon으로 나간다.
 *  4. F5를 누르면 클라이언트가 새로 만들어져 쿨다운이 사라지므로 정상 동작한다.
 *
 * 그래서 부트스트랩 조회는 전부 이 함수를 먼저 await 한다.
 * 반환값이 세션이면 JWT가 붙는 게 보장되고, null이면 '진짜 비로그인'이다.
 * 저장소에 세션이 있는데 못 살린 경우에는 **throw** 해서, 빈 화면 대신
 * 재시도 UI로 이어지게 한다. 조용히 비는 것보다 시끄럽게 실패하는 편이 낫다.
 */

const SESSION_RETRY_DELAYS_MS = [400, 1200, 3000];

// 동시에 여러 곳에서 불러도 refresh 왕복은 한 번만 돌게 묶는다.
let inflightSession = null;

async function resolveSession() {
  const { data, error } = await supabase.auth.getSession();
  if (data?.session) return data.session;

  // 세션도 없고 에러도 없다 = 로그인하지 않은 정상 상태.
  if (!error) return null;

  // 여기까지 왔다면 저장소엔 세션이 있는데 갱신에 실패한 것.
  // 그대로 두면 이후 모든 쿼리가 anon으로 나가므로 직접 재시도한다.
  // (refreshSession은 저장소의 refresh token을 다시 읽는다. 다른 탭이 그사이
  //  토큰을 회전시켰다면 새 토큰이라 위의 실패 쿨다운도 우회된다.)
  for (const delay of SESSION_RETRY_DELAYS_MS) {
    await sleep(delay);
    const { data: retry } = await supabase.auth.refreshSession();
    if (retry?.session) return retry.session;
  }

  throw Object.assign(
    new Error('세션을 갱신하지 못했습니다. 네트워크 상태를 확인해주세요.'),
    { cause: error },
  );
}

/**
 * DB 조회 전에 호출한다. 인증이 붙는 것을 보장한다.
 * @returns {Promise<object|null>} 세션 또는 null(비로그인)
 * @throws 저장된 세션이 있는데 복구에 실패한 경우
 */
export function ensureSession() {
  if (!inflightSession) {
    inflightSession = resolveSession().finally(() => { inflightSession = null; });
  }
  return inflightSession;
}

/**
 * 첫 접속은 DNS·TLS·콜드 커넥션이 겹쳐 단발성 실패가 가장 잦은 구간이다.
 * 부트스트랩 조회처럼 "실패하면 화면이 통째로 비는" 요청만 이걸로 감싼다.
 */
export async function withRetry(fn, { attempts = 3, baseDelayMs = 400, label = 'query' } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(baseDelayMs * 2 ** (i - 1));
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.warn(`[retry] ${label} 실패 (${i + 1}/${attempts})`, err);
    }
  }
  throw lastError;
}

/** PostgREST 응답의 error를 예외로 승격시킨다 (withRetry가 잡을 수 있도록). */
export function unwrap(res, label) {
  if (res.error) {
    throw Object.assign(new Error(`${label}: ${res.error.message || res.error}`), { cause: res.error });
  }
  return res.data;
}
