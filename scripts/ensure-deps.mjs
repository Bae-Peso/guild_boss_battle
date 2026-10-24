#!/usr/bin/env node
/*
 * node_modules 플랫폼 가드 — 설치된 플랫폼과 현재 플랫폼이 다르면 `npm ci`로 재설치한다.
 *
 * 왜 필요한가:
 *   이 저장소는 exFAT 볼륨에 두고 Windows / macOS / Linux를 오가며 쓴다.
 *   node_modules는 OS마다 내용이 달라서 공유가 안 된다.
 *     - .bin 실행 파일: Windows는 `node.exe`를 부르는 셸 스크립트, macOS/Linux는 심볼릭 링크
 *     - 네이티브 바인딩: vite(rolldown)·oxlint는 현재 OS용 바이너리만 설치된다
 *   그래서 다른 OS에서 설치한 채로 실행하면 `exec: node.exe: not found` 같은 에러로 죽는다.
 *
 * 사용:
 *   predev/prebuild/prelint/prepreview 에서 인자 없이 실행 → 필요하면 재설치
 *   postinstall 에서 `--mark` 로 실행 → 현재 플랫폼을 기록만 한다
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const markerPath = fileURLToPath(new URL('../node_modules/.installed-platform', import.meta.url));
const current = `${process.platform}-${process.arch}`;

if (process.argv.includes('--mark')) {
  writeFileSync(markerPath, current);
  process.exit(0);
}

let installed = null;
try {
  installed = readFileSync(markerPath, 'utf8').trim();
} catch {
  // 마커 없음 — 예전 설치본이거나 node_modules 자체가 없음
}

if (installed !== current) {
  const reason = existsSync(new URL('../node_modules', import.meta.url))
    ? `node_modules 플랫폼(${installed ?? '알 수 없음'}) ≠ 현재(${current})`
    : 'node_modules 없음';
  console.log(`[ensure-deps] ${reason} → npm ci 로 재설치합니다.`);
  execSync('npm ci', { cwd: root, stdio: 'inherit' });
  writeFileSync(markerPath, current);
}
