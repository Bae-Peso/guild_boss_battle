#!/usr/bin/env node
/*
 * 배포 검증 — 라이브 사이트의 index.html에서 출발해 참조되는 모든 자산을 재귀적으로 훑고,
 * JS/CSS 자리에 HTML이 돌아오는 URL이 하나라도 있으면 실패로 종료한다.
 *
 * 왜 필요한가 (2026-08-11 사고):
 *   `_redirects`의 `/* /index.html 200` 폴백 때문에, 없는 자산은 404가 아니라
 *   **200 + text/html**로 응답한다. 브라우저는 모듈 MIME 검사에서 이를 거부해 화면이
 *   통째로 안 뜨는데, 상태 코드가 200이라 네트워크 탭에 빨간 줄조차 안 남는다.
 *   게다가 `_headers`가 /assets/*에 immutable(1년)을 붙이므로 한 번 잘못 캐시되면
 *   오래 남는다. 배포 직후 이 스크립트로 자산 정합성을 확인하면 눈으로 못 잡는 이 상태를
 *   즉시 잡아낸다.
 *
 * 왜 자산마다 두 번 찌르는가 (2026-08-12 사고):
 *   이 스크립트가 잡으려던 상태를 스스로 만들어냈다. wrangler가 업로드를 마쳐도
 *   프로덕션 별칭이 모든 엣지에 전파되기까지는 짧은 틈이 있다. 그 틈에 새 자산 URL을
 *   요청하면 그 엣지는 파일을 못 찾아 폴백 HTML을 200으로 돌려주고, `_headers`의
 *   `/assets/* → immutable` 이 **그 HTML 응답에** 붙어 1년짜리로 캐시된다.
 *   그 뒤로는 몇 번을 재시도해도 같은 캐시 HIT만 돌아온다 — 자력 복구가 불가능하다.
 *
 *   그래서 순서를 뒤집었다.
 *     1) 먼저 `?__verify=` 를 붙여 찌른다. 캐시 키가 달라 진짜 자산 URL을 오염시킬 수
 *        없고, 배포본에 파일이 실제로 있는지(그리고 이 엣지가 그 배포본에 닿는지)를 본다.
 *     2) 1)이 통과한 뒤에야 원래 URL을 찌른다. 이 시점엔 전파가 끝난 게 확인됐으므로
 *        요청이 오염을 만들지 않는다. 여기서 HTML이 오면 그건 **이미 박혀 있던**
 *        오염된 캐시 엔트리다.
 *
 *   두 결과를 나눠 보면 처방이 갈린다.
 *     · 1)에서 실패  → 배포본에 파일이 없거나 아직 전파 전. 재배포가 답.
 *     · 1) 통과 + 2) 실패 → 엣지 캐시 오염. 재배포가 아니라 **퍼지**가 답이고,
 *       immutable 이라 기다려도 낫지 않으므로 재시도하지 않고 즉시 보고한다.
 *
 * 사용법:
 *   node scripts/verify-deploy.mjs                      (기본: http://localhost:4173)
 *   node scripts/verify-deploy.mjs https://예시.pages.dev
 *
 * 배포 직후에 돌려도 되도록, 전파 지연으로 보이면 잠깐 기다렸다 몇 번 다시 확인한다.
 */

const ORIGIN = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const ATTEMPTS = 4;
const RETRY_DELAY_MS = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ASSET_IN_HTML = /\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g;
// 정적 import 경로와 Vite의 __vite__mapDeps 프리로드 목록을 모두 잡는다.
const ASSET_IN_JS = /"(?:\.\/|assets\/)([A-Za-z0-9_.-]+\.(?:js|css))"/g;

const NO_CACHE = { 'cache-control': 'no-cache' };

function typeMatches(file, contentType) {
  const type = contentType || '';
  return file.endsWith('.css') ? type.includes('css') : type.includes('javascript');
}

/** 폴백 HTML이 어느 배포본을 가리키는지 — 배포 정합성 추적 단서. */
function servedEntryOf(html) {
  const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  return m ? m[0] : null;
}

async function crawl(nonce) {
  const seen = new Set();
  const missing = [];   // 배포본에 파일 자체가 없음 (또는 아직 전파 전)
  const poisoned = [];  // 파일은 있는데 원래 URL의 캐시가 HTML로 굳어 있음

  // 사용자가 실제로 받는 index.html에서 출발한다. 엣지에 낡은 HTML이 박혀 있으면
  // 이미 사라진 번들 파일명을 크롤하게 되고, 그 자체가 잡아야 할 증상이다.
  const rootRes = await fetch(ORIGIN + '/', { headers: NO_CACHE });
  if (!rootRes.ok) throw new Error(`${ORIGIN}/ 응답 ${rootRes.status}`);
  const html = await rootRes.text();

  const queue = [...html.matchAll(ASSET_IN_HTML)].map((m) => m[0].slice('/assets/'.length));
  if (queue.length === 0) throw new Error('index.html에서 자산 참조를 찾지 못했습니다. (빌드 산출물이 맞는지 확인)');

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);

    // ── 1단계: 캐시 키를 비켜서 배포본에 파일이 실제로 있는지 확인한다.
    //    진짜 자산 URL을 건드리지 않으므로 이 요청은 오염을 만들 수 없다.
    const bustRes = await fetch(`${ORIGIN}/assets/${file}?__verify=${nonce}`, { headers: NO_CACHE });
    const bustType = bustRes.headers.get('content-type') || '';
    if (!typeMatches(file, bustType)) {
      const body = await bustRes.text();
      missing.push({ file, status: bustRes.status, type: bustType, servedEntry: servedEntryOf(body) });
      // 전파가 안 끝난 상태다. 여기서 원래 URL을 찌르면 그게 바로 오염이 되므로 넘어간다.
      continue;
    }

    const body = await bustRes.text();
    if (!file.endsWith('.css')) {
      for (const m of body.matchAll(ASSET_IN_JS)) {
        if (!seen.has(m[1])) queue.push(m[1]);
      }
    }

    // ── 2단계: 이제 원래 URL. 전파가 끝난 게 확인됐으니 이 요청은 안전하고,
    //    HTML이 온다면 이전에 박힌 오염 엔트리다.
    const liveRes = await fetch(`${ORIGIN}/assets/${file}`, { headers: NO_CACHE });
    const liveType = liveRes.headers.get('content-type') || '';
    if (!typeMatches(file, liveType)) {
      const liveBody = await liveRes.text();
      poisoned.push({
        file,
        status: liveRes.status,
        type: liveType,
        servedEntry: servedEntryOf(liveBody),
        cacheStatus: liveRes.headers.get('cf-cache-status'),
        age: liveRes.headers.get('age'),
      });
    }
  }

  return { count: seen.size, missing, poisoned };
}

function reportPoisoned(poisoned) {
  console.error(`\n✗ 엣지 캐시가 오염된 자산 ${poisoned.length}개:`);
  for (const p of poisoned) {
    const cache = [p.cacheStatus && `cf-cache-status: ${p.cacheStatus}`, p.age && `age: ${p.age}`]
      .filter(Boolean).join(', ');
    console.error(`   ${p.file}  →  ${p.status} ${p.type}${cache ? `  (${cache})` : ''}`);
    if (p.servedEntry) console.error(`      폴백 HTML이 가리키는 엔트리: ${p.servedEntry}`);
  }
  console.error('\n배포본에는 파일이 정상적으로 들어 있습니다 (캐시를 비켜서 요청하면 올바른 JS/CSS가 옵니다).');
  console.error('전파가 끝나기 전에 이 URL을 요청한 쪽이 있어, 폴백 HTML이 immutable(1년)로 캐시된 상태입니다.');
  console.error('immutable 이라 기다려도 낫지 않습니다. Cloudflare 캐시를 퍼지하세요:');
  for (const p of poisoned) console.error(`   ${ORIGIN}/assets/${p.file}`);
  console.error('\n퍼지가 어려우면 `npm run deploy` 로 재배포해도 됩니다 — 빌드마다 자산 URL이');
  console.error('새로 발급되므로 오염된 URL은 아무도 참조하지 않는 고아가 됩니다.');
}

function reportMissing(missing) {
  console.error(`\n✗ 배포본에서 찾을 수 없는 자산 ${missing.length}개:`);
  for (const m of missing) {
    console.error(`   ${m.file}  →  ${m.status} ${m.type}` + (m.servedEntry ? `  (폴백 HTML이 가리키는 엔트리: ${m.servedEntry})` : ''));
  }
  console.error('\n캐시를 비켜서 요청해도 파일이 없습니다. 배포본이 섞였거나 불완전합니다.');
  console.error('`npm run deploy` 로 dist를 비우고 다시 올려주세요.');
  console.error('폴백 HTML이 현재 배포본이 아닌 다른 엔트리를 가리키면, 옛 배포본이 함께 응답하고 있다는 신호입니다.');
}

async function main() {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { count, missing, poisoned } = await crawl(`${Date.now()}-${attempt}`);

    if (missing.length === 0 && poisoned.length === 0) {
      console.log(`검사한 자산: ${count}개`);
      console.log('✓ 모든 자산이 올바른 Content-Type으로 응답합니다.');
      return;
    }

    // 오염은 재시도로 낫지 않는다 (immutable). 기다리게 하지 말고 바로 처방을 낸다.
    if (poisoned.length > 0) {
      if (missing.length > 0) reportMissing(missing);
      reportPoisoned(poisoned);
      process.exit(1);
    }

    if (attempt < ATTEMPTS) {
      console.log(`검사한 자산: ${count}개 — 미발견 ${missing.length}개. 전파 지연일 수 있어 ${RETRY_DELAY_MS / 1000}초 후 재확인 (${attempt}/${ATTEMPTS - 1})`);
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    reportMissing(missing);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ 검증 중 오류:', err.message);
  process.exit(1);
});
