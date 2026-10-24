import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* ── 배포마다 자산 URL을 새로 발급한다 ─────────────────────────────────────
 *
 * 2026-08-11 사고: 크롬/사파리에서만 워크스페이스 진입이 막혔다(파이어폭스는 정상).
 * 서버는 결백했다 — 라이브 자산 55개를 전수 크롤해도 전부 정상 타입이었고, 사용자
 * 브라우저의 `fetch()`도 전부 정상이었다. 그런데 같은 URL을 모듈로 `import()`하면
 * HTML이 돌아왔다. 셀룰러·VPN·시크릿창·사이트데이터 삭제 모두 무효.
 *
 * 끝까지 근본 원인을 특정하지 못했다. 확실한 건 **특정 자산 URL 몇 개가 그 사용자에게만
 * 오염돼 있었고, 재배포로 URL이 전부 새로 발급되자 즉시 해결됐다**는 것이다.
 * (dist를 비우는 것만으로는 부족했다 — Cloudflare Pages는 이전 배포본의 파일을 계속
 *  서비스하므로, 같은 내용을 다시 빌드하면 같은 해시 = 같은 URL로 되돌아간다.)
 *
 * 그래서 파일명에 빌드 식별자를 섞어, 배포마다 URL이 절대 재사용되지 않게 한다.
 * 이러면 "다시 배포한다"가 언제나 통하는 복구 수단이 된다.
 *
 * 대가: 내용이 안 바뀐 청크도 배포마다 캐시가 무효화된다. 엔트리가 gzip 90KB대인
 * 규모에선 감당 가능하며, 위 사고를 다시 겪는 것보다 싸다.
 *
 * 파일명의 소스 이름([name])은 일부러 남긴다 — 이번 진단에서 `BossImage`,
 * `useBossBattleSeasons` 같은 읽을 수 있는 청크 이름이 범위를 좁히는 결정적 단서였다.
 * ──────────────────────────────────────────────────────────────────────── */
function buildId() {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      + '-' + Date.now().toString(36).slice(-4)
  } catch {
    // git이 없는 환경(CI 아티팩트만 있는 경우 등)에서도 고유값은 보장한다.
    return Date.now().toString(36)
  }
}

const BUILD_ID = buildId()

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_ID}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_ID}[extname]`,
      },
    },
  },
})
