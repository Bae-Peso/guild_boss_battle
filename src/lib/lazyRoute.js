import { lazy } from 'react';

/* ── 배포 후 청크 로드 실패 복구 ───────────────────────────────────────────
 *
 * 배포할 때마다 청크 파일명 해시가 전부 바뀐다. 배포 전부터 열려 있던 탭이
 * 그 뒤에 **처음 방문하는** 라우트로 이동하면, 이미 사라진 옛 청크를 요청한다.
 * 게다가 _redirects의 `/* /index.html 200` 폴백 때문에 404도 아니고 HTML이
 * 200으로 돌아오고, 브라우저는 모듈 MIME 검사에서 이를 거부한다.
 * → import()가 reject → Suspense 경계가 죽어서 그 화면만 통째로 안 뜬다.
 *
 * 단일 번들일 때는 없던 위험이다. 모든 코드를 처음에 다 받아버리니 배포 이후에
 * 새로 가져올 파일이 아예 없었다. 코드 스플리팅의 대가이므로 여기서 흡수한다.
 *
 * import 실패는 사실상 "내가 들고 있는 index.html이 낡았다"는 신호다.
 * 리로드 한 번이면 새 index.html을 받아 해결된다. 다만 진짜 오류(네트워크 단절,
 * 청크 자체의 런타임 에러)일 때 무한 리로드에 빠지면 안 되므로 쿨다운을 둔다.
 * ──────────────────────────────────────────────────────────────────────── */

const RELOAD_KEY = 'nikke_chunk_reload_at';
const RELOAD_COOLDOWN_MS = 10_000;

// 방금 이 이유로 리로드했다면 다시 하지 않는다 (리로드 루프 방지).
// 시간 기반이라 몇 시간 뒤 다음 배포 때는 다시 복구할 수 있다.
function claimReload() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    return true;
  } catch {
    // 프라이빗 모드 등으로 sessionStorage를 못 쓰면 루프를 막을 방법이 없다.
    // 흰 화면보다 무한 새로고침이 더 나쁘므로 시도하지 않는다.
    return false;
  }
}

function importWithRecovery(factory) {
  return factory().catch((err) => {
    if (!claimReload()) throw err;
    window.location.reload();
    // 리로드가 실제로 시작될 때까지 Suspense를 매달아 둔다.
    // 여기서 throw하면 리로드 직전에 에러 화면이 한 번 번쩍인다.
    return new Promise(() => {});
  });
}

/**
 * React.lazy + 배포 직후 청크 유실 자동 복구.
 * 반환된 컴포넌트의 `.preload()`로 라우트 매치 전에 미리 받아둘 수 있다.
 */
export function lazyRoute(factory) {
  const load = () => importWithRecovery(factory);
  const Component = lazy(load);
  Component.preload = load;
  return Component;
}
