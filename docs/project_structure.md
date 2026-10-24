# 프로젝트 구조 분석서 — 길드 보스전 지휘소

> 작성일: 2026-08-07 · 분석 대상 브랜치: `production` (HEAD `79dca50`)
> 이 문서는 리포지토리의 **현재 코드 상태를 읽어 역으로 정리한 구조 문서**입니다.
> 기획 의도는 [implementation_plan.md](implementation_plan.md), 스키마 설계 원안은 [database_schema.md](database_schema.md),
> 게임 규칙 배경은 [nikke_boss_battle_mechanics.md](nikke_boss_battle_mechanics.md)를 참고하세요.

---

## 1. 한눈에 보기

**「승리의 여신: 니케」 길드(길드) 전용 실시간 협업 웹앱**입니다. 세 가지 축으로 구성됩니다.

| 축 | 내용 |
| :--- | :--- |
| 💬 **실시간 채팅** | Discord 형태의 채널 기반 채팅. 멘션·이미지·이모티콘·읽음 표시·푸시 알림 |
| 🔥 **보스전 지휘 (핵심)** | "딜량 테트리스" — 길드원의 모의전 기록을 보스 체력에 맞춰 배치·시뮬레이션하고 실전 타수로 확정 |
| 📋 **결산** | 시즌 종료 후 멤버별 타수/딜량/막타 기록을 확정(freeze)하고 이미지로 내보내기 |

### ⚠️ 용어 정정 — "Node.js 파일"이 아닙니다

요청에는 *Node.js 서비스*로 언급되었으나, 실제 구조는 다릅니다.

- **자체 Node.js 서버가 없습니다.** `src/`의 `.js`/`.jsx`는 전부 **브라우저에서 실행되는 React 코드**입니다.
- Node.js는 오직 **빌드 툴체인**(Vite, oxlint) 실행용으로만 쓰입니다.
- 서버 역할은 **Supabase(BaaS)** 가 전담합니다. 서버 사이드 커스텀 코드는 `supabase/functions/`의 **Deno** Edge Function 3개뿐입니다.

즉 **서버리스 SPA + BaaS** 아키텍처입니다.

```
┌──────────────────────────┐        ┌─────────────────────────────────────────┐
│  브라우저 (React SPA)     │        │  Supabase (백엔드 전부)                   │
│  ─────────────────────    │◄──────►│  ├ Auth        로그인/세션                │
│  Vite 번들 + PWA           │  HTTPS │  ├ PostgreSQL  39개 테이블 + RLS + RPC    │
│  Service Worker (푸시)     │   WSS  │  ├ Realtime    presence / postgres_changes│
│                           │        │  ├ Storage     nikke_images / chat_images │
│                           │        │  └ Edge Fn     send-push, image-proxy, …  │
└──────────────────────────┘        └─────────────────────────────────────────┘
                                              배포: Cloudflare Pages (.wrangler)
```

---

## 2. 기술 스택

| 영역 | 채택 기술 | 버전 |
| :--- | :--- | :--- |
| 프레임워크 | React | ^19.2.7 |
| 빌드 | Vite + `@vitejs/plugin-react` (Oxc) | ^8.1.0 |
| 라우팅 | react-router-dom (`BrowserRouter`) | ^7.18.0 |
| 백엔드 SDK | `@supabase/supabase-js` | ^2.108.2 |
| 다국어 | i18next / react-i18next | ^26.3.2 |
| 스타일 | 순수 CSS (CSS 변수 토큰) + 인라인 스타일 | — |
| 폰트 | Pretendard | ^1.3.9 |
| 이미지 내보내기 | html-to-image (`toPng`) | ^1.11.13 |
| 린터 | oxlint | ^1.69.0 |
| Edge Function | Deno (`npm:` / `jsr:` 임포트) | — |

> 상태관리 라이브러리(Redux/Zustand/React Query) **미사용** — React Context + `useState`로만 구성.

### 실행 명령

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm run lint
```

배포는 반드시 이 스크립트로 합니다 — dist를 비우고 빌드 → 업로드 → 자산 정합성 검증까지 한 번에 합니다.

```bash
npm run deploy
```

배포 상태만 따로 점검할 때:

```bash
npm run verify:deploy
```

> ⚠️ **`vite build`를 직접 호출하지 마세요.** `npm run build`는 `rm -rf dist`를 앞에 붙입니다. 이유는 §12 참고.

필요 환경변수 (`.env.local`, `.gitignore`의 `*.local`로 제외됨):

| 키 | 용도 |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Supabase 프로젝트 URL |
| `VITE_SUPABASE_ANON_KEY` | 익명 키 (RLS 전제) |
| `VITE_VAPID_PUBLIC_KEY` | Web Push 공개키 (`scripts/gen-vapid.ts`로 생성) |

---

## 3. 디렉터리 구조

```
Nikke_Guild_BossBattle/
├── index.html                  SPA 진입점 (PWA 메타/manifest 링크)
├── vite.config.js              Vite 설정 (플러그인 1개, 사실상 기본값)
├── package.json                name이 아직 "temp-app"
│
├── src/                        ← 애플리케이션 본체 (JS/JSX 94개 파일, 16,755줄 + CSS 1,618줄)
│   ├── main.jsx                createRoot + StrictMode + i18n 초기화
│   ├── App.jsx                 Provider 조립 + 전체 라우트 테이블 + 접근 가드
│   ├── index.css / App.css     디자인 토큰(CSS 변수) 및 전역 스타일
│   ├── i18n.js                 i18next 초기화 (기본 ko, fallback en)
│   │
│   ├── contexts/               전역 Context
│   │   ├── AuthContext.jsx     세션/사이트관리자 여부/글로벌 밴 + signIn·signUp·signOut
│   │   └── GameDataContext.jsx 니케 목록·게임 아이콘·이모티콘 팩 1회 로드 후 캐시
│   │
│   ├── demo/                   비가입자 "체험 모드"
│   │   ├── DemoContext.jsx     메모리 목업 스토어 + 뮤테이션 API (rev 카운터로 재조회 유도)
│   │   └── demoFixtures.js     목업 길드/멤버/채널/보스/타수 시드
│   │
│   ├── lib/                    도메인 무관 순수 유틸 (12개)
│   ├── hooks/                  재사용 훅 (9개)
│   ├── utils/burst.js          버스트 비트마스크 헬퍼
│   ├── components/             공용 컴포넌트 + components/chat/ 채팅 부품 9개
│   ├── locales/{ko,en}/        번역 리소스 (현재 키 3개 — §11 참고)
│   │
│   └── pages/
│       ├── Login / SignUp / Lobby / MyPage
│       ├── admin/              사이트 최고관리자 백오피스 (13개 페이지 + AdminLayout)
│       └── workspace/          길드 워크스페이스 (핵심 영역)
│           ├── WorkspaceLayout.jsx     3분할 셸 + 실시간 허브 (865줄)
│           ├── WorkspaceMobileShell.jsx 모바일 하단 탭 셸
│           ├── BossBattleDashboard.jsx       지휘 현황판 = 딜량 테트리스 (1,059줄)
│           ├── MockBattleDashboard.jsx 모의전 기록 관리 (1,117줄)
│           ├── GuildBossBattleStatus.jsx     타수/딜량 랭킹표 (426줄)
│           ├── Settlement.jsx / SettlementBoss.jsx  결산
│           ├── WorkspaceChat.jsx / BossBattleChatPanel.jsx  일반/지휘 채팅
│           ├── GuildSettings.jsx + settings/  길드 설정 8개 탭
│           └── panels/                 좌·우 사이드바 패널 4종
│
├── supabase/
│   ├── functions/              Deno Edge Function 3개
│   └── migrations/             증분 마이그레이션 16개
│       ├── 20260810120000_environment_setup.sql   덤프가 못 잡는 환경 설정
│       │                       (Storage 버킷 / Realtime publication / pg_cron)
│       ├── 20260810130000_rls_scope_boss_battle_tables.sql  보스전 테이블 RLS 스코프 + 인덱스
│       ├── 20260811120000_boss_battle_hit_cap_by_identity.sql  3타 캡 판정을 인물 병합 기준으로
│       └── 20260811130000_boss_battle_identity_by_nickname.sql  인물 식별에서 싱크로 제거
│
├── public/                     manifest.json, sw.js(푸시 전용 SW), icons/, _redirects
├── scripts/                    gen-vapid.ts (VAPID 키 생성), test_*.js
├── docs/                       기획·스키마·게임규칙·태스크 문서 (+ 본 문서)
│
├── schema.sql                  ← 라이브 DB 전체 덤프 (3,506줄). "진실의 원천"
├── nikkes_data.csv + seed.cjs  니케 마스터 데이터 시드
└── mockup*.html                초기 디자인 시안 (참고용)
```

---

## 4. 프론트엔드 아키텍처

### 4-1. Provider 계층

`src/App.jsx:134`

```
AuthProvider                 세션·isAdmin·globalBanReason (세션 준비 전 children 렌더 차단)
 └ GameDataProvider          nikkes / game_icons / emoticon_packs 전역 캐시
    └ BrowserRouter
       └ DemoProvider        체험 모드 (라우터 하위 — 내부에서 navigate 사용)
          └ AppRoutes
```

### 4-2. 라우트 테이블

| 경로 | 컴포넌트 | 접근 조건 |
| :--- | :--- | :--- |
| `/login`, `/signup` | Login / SignUp | 비로그인 (로그인 시 `RootRedirect`) |
| `/` | `RootRedirect` | 사이트관리자 → `/admin`, 승인 길드 보유 → `/workspace`, 그 외 → `Lobby` |
| `/mypage` | MyPage | 로그인 (`PrivateRoute`) |
| `/admin/*` | AdminLayout + 13개 자식 | `isAdmin` (site_admins.is_active) |
| `/workspace/*` | WorkspaceLayout + 7개 자식 | 로그인 + 승인된 길드 소속 |

**워크스페이스 자식 라우트**

| 경로 | 화면 |
| :--- | :--- |
| `channel/:channelId` | 일반 채팅 |
| `boss-battle-dashboard` | 🔥 지휘 현황판 (딜량 테트리스) |
| `mock-battles` | 모의전 기록 대시보드 |
| `guild-boss-battle-status` | 📊 타수·딜량 랭킹표 |
| `settlement` / `settlement/boss/:bossNumber` | 📋 결산 / 보스별 결산 상세 |
| `settings` | 길드 설정 (모달로도 열림) |

**관리자 백오피스 13개 페이지**: DashboardHome, GuildManagement, GlobalBosses(시즌 보스·체력표 세팅), Reports, UserManagement, UidRequests, NikkeManagement, GameIconsManagement, ProfileImageManagement, EmoticonManagement, ChatImageSettings, SiteNotices, AuditLogs

> 가드는 **이중 적용**됩니다 — `App.jsx`의 `PrivateRoute`/`RootRedirect`와 `AdminLayout` 내부 `Navigate`.

### 4-3. WorkspaceLayout — 애플리케이션의 허브

`src/pages/workspace/WorkspaceLayout.jsx`는 단순 레이아웃이 아니라 **실시간 구독의 중앙 허브**입니다. 마운트 시 다음을 한 번에 수행합니다.

1. `union_members` 조인 조회로 소속 길드·역할·인게임 닉네임 확정
2. 채널·멤버·프로필이미지·대기 요청 수·읽음 상태를 `Promise.all` 병렬 조회
3. 채널이 하나도 없고 본인이 `admin`이면 기본 채널(`일반`, `공지사항`) 자동 생성
4. 읽음 기록이 없는 스코프는 `now`를 baseline으로 seed (첫 접속 시 과거 메시지 폭탄 방지)
5. **Realtime 채널 5종 + presence 1종** 구독 (§7)

하위 화면에는 `<Outlet context={...}>`로 아래 값을 내려보냅니다.

```js
{ guild, role, user, inGameName, channels, allMembers, synchroLevel, setSynchroLevel,
  onlineUsers, isAdmin, profileImagesMap, leftCollapsed, rightCollapsed,
  isMobile, isNarrow, isDemo }
```

### 4-4. 반응형 전략

- `useIsMobile(820)` — 820px 이하에서 `WorkspaceMobileShell`(하단 탭)로 **셸 자체를 교체**
- `useElementWidth()` — 창 폭이 아니라 **가운데 콘텐츠 영역의 실측 폭**(ResizeObserver)에 반응. 좌·우 패널 접기/펴기로 가용 폭이 바뀌기 때문
- 데스크톱 좌·우 사이드바는 마우스 드래그로 폭 조절(200~500px / 250~600px)

### 4-5. 상태 저장 위치 정리

| 저장소 | 내용 |
| :--- | :--- |
| React Context | 세션, 게임 마스터 데이터, 데모 스토어 |
| Outlet context | 길드/역할/멤버 등 워크스페이스 공통 상태 |
| `localStorage` | HP 표기 모드, 스쿼드 표시, 아바타 모서리 배지, 컬럼 폭, 보드 배율, 최근 이모티콘, 알림음 On/Off |
| `sessionStorage` | `nikke_demo` 체험 모드 플래그 |
| **DB** (`chat_read_state`) | 채팅 읽음 위치 — 기기 간 공유를 위해 localStorage에서 승격됨 |

---

## 5. 백엔드 (Supabase) 구조

### 5-1. 테이블 도메인 그룹

총 **39개 테이블 · 118개 RLS 정책 · 12개 함수**. 2026-08-07 라이브 DB 재덤프로 확인된 수치이며, `schema.sql` 한 파일에 전부 담겨 있습니다(§5-6의 재현 절차 참고).

도메인별로 묶으면 다음과 같습니다.

**① 계정·권한**
`users`(uid·싱크로레벨·프로필·글로벌밴) · `site_admins` · `unions` · `union_members`(역할/가입상태/상태메시지) · `union_join_passphrases` · `union_nickname_requests` · `uid_change_requests` · `audit_logs`

**② 채팅**
`channels`(soft delete용 `deleted_at`) · `messages` · `raid_messages`(지휘 전용, `room_type` = general\|admin) · `chat_read_state` · `emoticon_packs` / `emoticons` · `app_settings`(채팅 이미지 보존일수 등)

**③ 보스전 마스터 데이터 (사이트 관리자 영역)**
`raid_seasons`(시즌명·기간) · `global_raid_bosses`(시즌별 5마리, 속성/등급/이미지) · `raid_season_hp_settings`(단계별 로드급/타일런트급 체력표) · `nikkes` · `game_icons` · `profile_images`

**④ 보스전 운영 데이터 (길드 영역) — 핵심**
`union_raid_status`(길드×보스×단계의 현재 HP/클리어 여부/클리어 시각) · `mock_battles`(모든 타수 기록의 단일 테이블) · `union_raid_season_settings`(시즌 잠금) · `recommended_squads` · `union_boss_memos`

**⑤ 결산**
`union_settlement_status`(시즌 확정 여부) · `union_settlement_members`(확정 시 얼린 싱크로/닉네임 + 관리자 비고)

**⑥ 알림·공지**
`user_notifications` · `push_subscriptions` · `site_notices` / `union_notices` + 각 읽음 테이블 · `reports` · `daily_statistics` · `user_favorite_nikkes` · `union_member_note_fields` / `union_member_notes`

### 5-2. RPC (Postgres 함수)

| 함수 | 역할 |
| :--- | :--- |
| `init_union_raid_status(union_id, season)` | 시즌 체력표를 읽어 **1~max 단계 × 보스 5마리** 행을 일괄 생성. 추가로 **5번 보스의 무한 단계(max+1, HP 0)** 생성 |
| `apply_real_battle_damage(mock_id, dmg, is_last_hit)` | 타수를 실전으로 확정. 대상 행을 `FOR UPDATE`로 잠그고 차감 |
| `revert_real_battle_damage(mock_id)` | 실전 타수를 계산기로 되돌리고 체력 복원 |
| `is_site_admin()` | RLS 정책 전반에서 쓰이는 SECURITY DEFINER 헬퍼 |
| `update_status_message` / `update_user_ban_status` / `delete_user_by_admin` / `update_daily_statistics` / `verify_union_passphrase` | 각 관리 기능 |
| 트리거 | `handle_new_user`(가입 시 users 행 생성) · `update_user_uid_on_approval` · `set_union_raid_status_cleared_at`(is_cleared 전이 시 `cleared_at` 자동 기록) |

### 5-3. Storage 버킷

| 버킷 | 용도 | 정책 |
| :--- | :--- | :--- |
| `nikke_images` | 니케 이미지 (관리자 업로드, public URL 사용) | — |
| `chat_images` | 채팅 첨부 이미지 (public) | 조회 공개 / 업로드는 authenticated / **삭제는 service_role만** |

업로드 경로는 `lib/imageCompress.js` → `lib/chatImage.js`. 긴 변 1600px 리사이즈 + WebP 재인코딩(품질 0.8), 입력 상한 15MB. 무료 스토리지 한도 절감이 목적입니다.

### 5-4. Edge Functions (Deno)

| 함수 | 트리거 | 하는 일 |
| :--- | :--- | :--- |
| `send-push` | `user_notifications` INSERT Database Webhook | 해당 유저의 모든 `push_subscriptions`로 Web Push 발송. 404/410 응답 구독은 자동 삭제. `x-push-secret` 헤더로 인증 |
| `cleanup-chat-images` | pg_cron(`x-cleanup-secret`) 또는 관리자 수동 호출 | `app_settings.chat_image_retention_days`(기본 7일)를 넘긴 `chat_images` 객체를 최대 1000건씩 삭제 |
| `image-proxy` | 결산 "이미지로 저장"(html-to-image) | CORS 헤더가 없는 외부 이미지를 서버가 대신 받아 CORS를 붙여 재전송. **호스트 allowlist**(blablalink.com, wikia.nocookie.net)로 SSRF 차단, 15MB 상한 |

셋 다 `--no-verify-jwt`로 배포하고, 함수 내부에서 자체 인증(시크릿 헤더 / `is_site_admin()` RPC / allowlist)을 수행합니다.

### 5-5. 스키마 재덤프 절차

`schema.sql`은 **라이브 DB의 전체 스냅샷**이며, 아래 명령으로 재생성합니다.

```
pg_dump -h aws-X-<region>.pooler.supabase.com -p 5432 \
        -U postgres.<project-ref> -d postgres -W \
        --schema-only --no-owner --no-privileges --schema=public \
        -f schema.sql
```

**주의사항 (실제로 겪은 함정)**

| 항목 | 값 | 이유 |
| :--- | :--- | :--- |
| 호스트 | **pooler** (`*.pooler.supabase.com`) | 직결 주소 `db.<ref>.supabase.co`는 **IPv6 전용** — IPv4 망에서 도달 불가 |
| 포트 | **5432** (session mode) | 6543(transaction mode)은 `pg_dump` 비호환 |
| 유저명 | `postgres.<project-ref>` | ref를 빼면 `Tenant or user not found` |
| 비밀번호 | Settings → Database에서 **재설정** | 계정 비밀번호·API 키와 별개. 조회 불가, 재설정만 가능 |
| 도구 | Homebrew `libpq`의 네이티브 `pg_dump` | `supabase db dump`는 Docker를 거치고 직결 주소로 폴백함 |

> `supabase link`는 CLI v2.112.0 기준 `failed to get api keys: SchemaError(... inserted_at)`로 실패합니다. 새 API 키 체계의 타임스탬프 형식을 CLI가 검증하지 못하는 버그이며, 덤프에는 link가 필요 없습니다.

**이 덤프에 포함되지 않는 것** — `--schema=public` 범위 밖이라 별도 관리가 필요합니다. 실제로 재덤프 후 확인해보니 `cron`·`supabase_realtime`·`storage` 관련 항목이 **전부 0건**이었습니다.

| 누락 항목 | 스키마 | 현재 관리 위치 |
| :--- | :--- | :--- |
| Storage 버킷 | `storage` | ✅ `20260810120000_environment_setup.sql` |
| Realtime publication 멤버십 | 클러스터 전역 | ✅ 〃 |
| pg_cron 스케줄 2건 | `cron` | ✅ 〃 (시크릿 필요분은 주석) |
| Edge Function 시크릿 | — | ❌ Dashboard에만 존재 |
| Database Webhook 설정 | — | ❌ Dashboard에만 존재 |

`20260810120000_environment_setup.sql`은 전부 재실행 안전(idempotent)하며, 파일 하단 **부록 A**에 운영 DB 현재 상태를 조회하는 쿼리가 들어 있습니다. 적용 전 비교용입니다.

### 5-6. RLS 요약

- `is_site_admin()` 기반 **관리자 bypass 정책**이 주요 테이블에 존재
- 길드 스코프 테이블은 대부분 `EXISTS (select 1 from union_members where ... and join_status='approved')` 패턴
- 관리 전용 테이블(`union_member_notes`, `guild_settlement_*`)은 `role in ('admin','sub_admin')` 요구
- 개인 스코프 테이블(`push_subscriptions`, `chat_read_state`, `user_*_reads`)은 `auth.uid() = user_id`

---

## 6. 핵심 도메인 로직 — 딜량 테트리스

### 6-1. 데이터 준비 파이프라인

```
[사이트 관리자] /admin/bosses
   raid_seasons + global_raid_bosses(5마리) + raid_season_hp_settings(단계별 체력) 등록
                        │
                        ▼
[길드 관리자] 길드 설정 > 보스전 기록 관리 탭
   init_union_raid_status(union_id, season) 호출
                        │
                        ▼
   union_raid_status 행 생성 = (보스 5) × (단계 1..max) + 5번 보스 무한 단계
```

`useBossBattleSeasons` 훅은 **해당 길드가 실제 `union_raid_status` 행을 가진 시즌만** 필터링해 드롭다운에 노출합니다.

### 6-2. 보스·단계 모델

- 보스 1~5번, 단계는 체력표의 `max(stage_level)`까지 (하드 기준 통상 3단계)
- **5번 보스만 `max_stage + 1`의 "무한 단계"** 를 가집니다. 게임 규칙상 4단계는 무한 체력 보스 1기만 등장하므로, 이 행은 HP 0에서 시작해 딜을 넣을수록 **누적(+)** 됩니다. 되돌리기는 반대로 차감(−)
- 화면 진입 시 각 보스의 표시 단계는 "미클리어 최소 단계", 전부 클리어면 "최대 클리어 단계 + 1"로 자동 계산

### 6-3. `mock_battles` 레코드 생명주기

모든 타수 기록이 이 한 테이블에 담기고, 세 개의 플래그가 위치를 결정합니다.

| 상태 | `status` | `is_queued` | `is_in_calc` | 보이는 곳 |
| :--- | :--- | :--- | :--- | :--- |
| 모의전 기록 | `pending` | false | false | 모의전 대시보드 |
| 대기열(Pool) | `pending` | **true** | false | 지휘 현황판 좌측 대기열 |
| 계산기(시뮬레이션) | `pending` | true | **true** | 지휘 현황판 계산기 — 예상 HP에 반영 |
| 실전 확정 | **`completed`** | — | — | 랭킹표·결산에 집계 |

계산기 영역은 `calcDmgSum = Σ expected_damage`를 현재 HP에서 빼서 **예상 잔여 HP와 오버킬 여부를 실시간 시각화**합니다. 이것이 "딜량 테트리스"의 실체입니다.

### 6-4. 실전 적용의 동시성 처리 (중요)

과거에는 클라이언트가 `current_hp`를 읽어 계산한 **절대값을 덮어쓰는** 방식이었고, 두 명이 동시에 적용하면 나중 쓰기가 앞선 딜량을 통째로 지우는 유실 버그가 있었습니다.
`20260714120000_atomic_real_damage_rpc.sql`이 이를 **원자적 RPC**로 교체했습니다.

`apply_real_battle_damage`의 처리 순서:

1. `mock_battles` 행 + `union_raid_status` 행을 `SELECT ... FOR UPDATE`로 잠금 → 동시 호출 자동 직렬화
2. 가드: `already_completed` / `boss_cleared` / **시즌 3타 캡**(`cap_reached`) / `overkill_without_last_hit`
3. 분기 계산
   - 무한 단계 → `current_hp + damage` (누적)
   - **막타** → `real_damage`에는 남은 체력만 기록(오버킬 절삭), HP는 `expected_damage`만큼 차감하고 `is_cleared = true`
   - 일반 → `current_hp - damage`
4. 이번 완료로 3타에 도달하면, 같은 인물의 남은 대기/계산 기록을 모의전 탭으로 자동 하강

`revert_real_battle_damage`는 정확히 역연산합니다. **막타였던 기록은 `real_damage`가 아니라 `expected_damage`를 복원**해야 한다는 점이 핵심(오버킬 절삭 때문)입니다.

2번과 4번의 "같은 인물" 판정은 원래 `user_id`(본인 작성) / `manual_nickname`(수기) 단일 기준이었습니다.
한 사람의 기록이 두 갈래로 섞이면(관리자 대리 입력이 흔합니다) 타수가 갈라져 3타를 인식하지 못했고,
결과적으로 **3타를 다 쓴 뒤에도 대기열에 기록이 남고 4타째가 새어나가는** 버그가 있었습니다.
`20260811120000_boss_battle_hit_cap_by_identity.sql`이 §6-5와 동일한 병합 규칙을 SQL로 옮긴
`raid_identity_key(union_id, is_admin_written, user_id, manual_nickname, synchro_level)`를 추가하고,
카운트와 하강 대상 선정에 모두 이 키를 쓰도록 바꿨습니다.
화면(`BossBattleDashboard`)도 3타 소진 인물의 대기/계산 카드를 감춰, 이미 남아버린 기록까지 노출되지 않게 합니다.

### 6-5. 인물 정체성 병합 (`lib/identity.js`)

같은 사람의 기록이 **본인 작성(`user_id` 기준)** 과 **관리자 대리 입력(`manual_nickname` 기준)** 으로 갈라져 다른 인물처럼 집계되던 문제를 해결하는 모듈입니다.

- 기본 규칙: **닉네임이 같으면 동일 인물** (`n <닉네임>`)
  - 본인 작성은 작성자의 로스터 닉네임, 수기 기록은 적힌 `manual_nickname`을 쓴다
  - 한 길드 안에서 인게임 닉네임은 사실상 유일하다는 전제
- 본인 작성인데 멤버를 찾을 수 없으면(탈퇴) `u <user_id>`로 개별 취급
- 싱크로 레벨은 **표시용으로만** 쓴다(`synchroOf`). 예전에는 키에 포함했지만, 대리 입력 멤버는
  본인이 직접 올리지 않는 한 `users.synchro_level`이 갱신되지 않아 같은 사람의 기록이 시즌이
  지날수록 싱크로 차이로 갈라졌다

`BossBattleDashboard`, `GuildBossBattleStatus`, `MockBattleDashboard`, `Settlement`가 모두 이 키를 공유합니다.
**DB의 `raid_identity_key()`도 반드시 같은 규칙이어야 합니다** — 어긋나면 3타 캡/자동 하강이
화면 표시와 따로 놀게 됩니다(§6-4 참고).

### 6-6. 결산 (Settlement)

- 대부분의 값은 `mock_battles` / `union_raid_status`에서 **실시간 파생**
- 시즌 종료 후 변하면 안 되는 값만 `union_settlement_members`에 **동결**: `synchro_level`, `prev_synchro_level`, `display_name`(탈퇴 후에도 닉네임 유지), `note`
- `union_settlement_status.is_finalized`가 게이트 — 확정 전엔 관리자만, 확정 후엔 전원 열람
- 진입점은 **지휘 네비(`BossBattleNavPanel`)의 `📋 결산` 링크 한 곳** — 예전엔 타수 현황판/지휘 현황판 헤더에 각각 버튼이 있었으나 컨트롤 바가 빽빽해져 통합했습니다. 일반 멤버에게는 확정된 결산이 하나라도 있을 때만 노출됩니다
- 비고(`note`)는 랭킹표(`GuildBossBattleStatus`)와 결산 화면이 **같은 행을 공유**하며, `member_key`는 `user:<uuid>` 또는 `manual:<닉네임>` 규약
- "이미지로 저장"은 `html-to-image`의 `toPng` + 필요 시 `image-proxy` 경유

---

## 7. 실시간 · 알림 파이프라인

### 7-1. Realtime 구독 매트릭스

`supabase.js`는 클라이언트를 `realtime: { worker: true, heartbeatIntervalMs: 15000 }`로 생성합니다 — 하트비트를 Web Worker에서 돌려 **백그라운드 탭 타이머 스로틀링으로 인한 연결 끊김을 방지**합니다.

| 채널명 패턴 | 구독 대상 | 위치 |
| :--- | :--- | :--- |
| `presence:guild_<id>` | **Presence**(접속자) + `union_members` + `channels` | WorkspaceLayout |
| `sys_msg_<channelId>_<userId>` | `messages` INSERT (채널별) | WorkspaceLayout |
| `sys_boss_battle_<guildId>_<userId>` | `raid_messages` INSERT | WorkspaceLayout |
| `sys_notif_<userId>` | `user_notifications` INSERT | WorkspaceLayout |
| `sys_users_<guildId>_<userId>` | `users` UPDATE (프로필·싱크로 반영) | WorkspaceLayout |
| `sys_nick_<guildId>_<userId>` | `union_nickname_requests` | WorkspaceLayout |
| `boss_battle_dashboard_status_*` / `boss_battle_dashboard_mocks_*` | `union_raid_status` / `mock_battles` | BossBattleDashboard |
| `guild_boss_battle_status_live_<guildId>_*` | 위 두 테이블 (전체 재조회 트리거) | GuildBossBattleStatus |
| `settlement_<guildId>` | 결산 관련 | Settlement |

**코드에 남은 실무 노하우 두 가지**

- Presence 이탈 시 즉시 오프라인 처리하지 않고 **10초 유예 타이머**를 둬 깜빡임을 방지
- DELETE 이벤트는 `REPLICA IDENTITY FULL` 없이는 서버측 `filter`에 매칭되지 않음 → 일부 구독은 **필터 없이 전체 구독 후 클라이언트에서 판별**

### 7-2. 멘션 처리 (`lib/chatUtils.js`)

- 전송 직전 `@닉네임` → `<@user_id>` 토큰으로 **인코딩**하여 저장 (닉네임 변경에 강함)
- 정규식에 `(?=[\s,.!?]|$)` 경계를 두고 **긴 닉네임부터 치환**해 부분 매칭 오탐 방지
- 특수 멘션: `@!all`(전체), `@!mod`(관리자)
- 표시·알림·안읽음 판정이 **동일한 경계 규칙**(`isMentioned`)을 공유
- 도배 방지 쿨다운 `CHAT_COOLDOWN_MS = 1000`

### 7-3. 3단 알림 경로

```
멘션 발생 → user_notifications INSERT
                │
                ├─(A) Realtime 구독 → 인앱 토스트(5초) + Notification API + 알림음
                │
                └─(B) Database Webhook → Edge Fn send-push → Web Push → sw.js
                                                                  │
                                       포커스된 창이 있으면 SW는 표시를 skip
                                       (A와 B가 같은 tag `notif-<id>`를 써 중복 병합)
```

`public/sw.js`는 **오프라인 캐싱을 하지 않는 푸시 전용 서비스 워커**입니다(의존성 0 유지).

### 7-4. 읽음 상태 (`lib/chatReadState.js`)

스코프 키 규약: `ch:<channelId>` / `bossBattle:<room>:<guildId>`
`chat_read_state` 테이블에 사용자×스코프 1행 upsert. 모든 쓰기는 best-effort(실패해도 조용히 무시). 체험 모드에서는 읽기·쓰기 모두 생략합니다.

---

## 8. 공용 유틸 · 훅 카탈로그

### `src/lib/`

| 파일 | 역할 |
| :--- | :--- |
| `supabase.js` | 클라이언트 싱글턴 (Realtime worker 설정 포함) |
| `roles.js` | `isManager(role)` — 흩어져 있던 `admin \|\| sub_admin` 판정 통일 |
| `identity.js` | 인물 정체성 병합 (§6-5) |
| `format.js` | HP/딜량 표기 — `formatHp`(상세/간이), `formatHpUnits`(조·억·만), `formatHpShort`, 채팅 날짜 구분선, `formatChatTimeShort`(연속 메시지 hover 시간) |
| `chatUtils.js` | 멘션 인·디코딩, 쿨다운, 이모티콘 `$$EMOTI$$` 인코딩, 최근 이모티콘, 연속 메시지 묶기(`isContinuation`), 날짜별 묶기(`groupMessagesByDay` — 스티키 날짜 헤더) |
| `chatReadState.js` | 읽음 위치 DB 동기화 |
| `chatImage.js` / `imageCompress.js` | 채팅 이미지 압축 → 업로드 → public URL |
| `push.js` | 서비스워커 등록, 구독/해지, `getPushStatus` |
| `sound.js` | 멘션 알림음 (1700ms 후 자동 정지) |
| `auditLogger.js` | `audit_logs` 삽입 헬퍼 |

### `src/hooks/`

| 훅 | 역할 |
| :--- | :--- |
| `useBossBattleSeasons` | 길드가 실제 데이터를 가진 시즌만 제공 + `bossBattleDataChanged` 전역 이벤트로 재조회 |
| `usePreferences` | HP 표기 모드·스쿼드 표시 (localStorage + `prefChange` CustomEvent로 화면 간 동기화) |
| `useChatAutoScroll` | 최초 하단 이동 / 과거 prepend 시 위치 유지 / 새 메시지 배지 |
| `useChatImageUpload` | 클립보드 붙여넣기 → 자동 업로드 → 미리보기 |
| `useAutoResizeTextarea` | 채팅 입력창·수정창 줄 수에 맞춘 자동 높이 (Shift+Enter 줄바꿈, min/max 높이, 초과 시 내부 스크롤) |
| `useMediaQuery` | `useIsMobile` · `useIsNarrow` · `useElementWidth`(ResizeObserver) |
| `useTableSort` | 점 표기 경로(`unions.name`) 및 커스텀 accessor 지원 정렬 |
| `useResizableColumn` | 엑셀식 열 너비 드래그 (포인터 이벤트, localStorage 유지) |
| `useAvatarSettings` | 니케 아바타 모서리 배지 4종 설정 |
| `useEscapeKey` | ESC로 모달 닫기 |

> `components/chat/`의 9개 부품(MessageText, MentionAutocomplete, MessageContextMenu, ImageLightbox, ChatScrollControls, EmojiPicker, EmoticonMessage, ChatDateDivider, MessageEditModal)은 **일반 채팅과 지휘 채팅이 공유**합니다.
> 같은 폴더의 `chat.css`는 연속 메시지 hover 시간 표시용 규칙(`.chat-msg-row:hover .chat-hover-time`)으로, 메시지가 많아도 리렌더가 없도록 React state 대신 CSS로 처리합니다.

---

## 9. 체험(데모) 모드

로비의 "체험하기"로 진입하는, **가입 없이 워크스페이스를 둘러보는 모드**입니다.

- `sessionStorage.nikke_demo = '1'` 플래그 (새로고침에도 유지, 단 데이터 스토어는 메모리라 리셋)
- `demoFixtures.js`가 목업 길드/멤버/채널/보스/타수를 생성
- **DB 쓰기·Realtime 구독·푸시 구독·읽음 상태 저장을 전부 우회**
- `demo.rev` 카운터를 각 페이지 fetch effect의 의존성에 넣어 Realtime을 대체
- 뮤테이션 메서드가 생성/수정된 row를 반환해, 기존 "낙관적 갱신" 코드를 그대로 재사용

거의 모든 데이터 접근 지점에 `if (demo.isDemo) { ... return; }` 분기가 들어 있습니다.

---

## 10. 배포 · PWA

- **Cloudflare Pages** 배포 (`.wrangler/tmp/pages-*`, `public/_redirects`의 SPA fallback `/* /index.html 200`)
- `dist/`가 커밋되어 있음 (빌드 산출물)
- PWA: `manifest.json`(standalone, `start_url: /workspace`) + `sw.js`(푸시 전용) + 180/192/512 아이콘
- 모바일 대응: `viewport-fit=cover`, `apple-mobile-web-app-capable`

---

## 11. 관찰된 특징 및 개선 여지

사실 관계만 정리한 것으로, 즉시 조치가 필요하다는 뜻은 아닙니다.

### 리포지토리 위생

- ✅ **[해결 2026-08-07]** `emoticon_packs` / `emoticons` / `union_join_passphrases` 3개 테이블이 어느 스키마 파일에도 없던 문제 — 라이브 DB 재덤프로 `schema.sql`에 편입(§5-5).
- ✅ **[해결 2026-08-10]** 루트의 개발 중 임시 파일 **66개 삭제**. DDL 이력 SQL 40개는 재덤프로 `schema.sql`에 반영되었고, 일회성 점검/수정 스크립트 20개와 Windows 배치 2개, macOS AppleDouble 잔재 4개를 제거했습니다.
  - ⚠️ 이때 `setup_cron.sql`, `setup_chat_image_cleanup_cron.sql`, `enable_realtime_chat.sql`, `enable_realtime_users.sql` 4개는 **덤프가 못 잡는 설정의 유일한 기록**이었습니다. 그냥 지웠다면 Realtime과 크론 설정이 소실될 뻔했고, `20260810120000_environment_setup.sql`로 이관한 뒤 삭제했습니다.
  - 보존: `schema.sql`(진실의 원천), `nikkes_data.csv` + `seed.cjs`(니케 시드), `mockup*.html`(초기 디자인 시안).
- ✅ **[해결 2026-08-10]** `nikke_images` Storage 버킷 정의 부재 — `environment_setup` 마이그레이션에 추가(public 조회 / 사이트 관리자만 쓰기·삭제). **운영 DB 적용 완료**, 버킷 생성 확인됨.
- ✅ **[해결 2026-08-10]** Realtime publication 15개 테이블, `daily-snapshot-job` 크론 등록 확인. `supabase/config.toml`도 생성되어 커밋됨.
- ❌ **미해결**: `git config core.autocrlf`가 로컬·전역 모두 `true`입니다(Windows 시절 잔재). macOS에서는 체크아웃마다 LF→CRLF 변환이 일어나 diff가 통째로 변경된 것처럼 잡힙니다. `input` 권장.
- ❌ **미해결**: `supabase/.temp/`가 **이전 프로젝트 ref**(`jtmgkethjgjfcjwrkcmm`)를 가리킨 채 남아 있습니다. 다만 `supabase/.gitignore`가 `.temp`를 제외하므로 저장소에는 영향 없습니다.
- ❌ **미해결**: Edge Function 시크릿과 Database Webhook 설정은 여전히 Dashboard에만 존재합니다(§5-5). `cleanup-chat-images-daily` 크론도 `CLEANUP_SECRET`이 필요해 미등록 상태입니다.
- ❌ **미해결**: Realtime publication에 SELECT 정책이 `USING(true)`인 테이블이 섞여 있는지 점검 필요. publication 소속 테이블은 변경사항이 구독자에게 브로드캐스트되고, 그 필터가 곧 SELECT 정책이기 때문입니다.
- `package.json`의 `name`이 여전히 `"temp-app"`.
- 시크릿 파일(`.env.local`, `vapid-secrets.env.local`)은 `.gitignore`의 `*.local`로 **정상 제외**되어 있습니다(추적 확인 완료).

### i18n

`src/locales/{ko,en}/translation.json`에 최상위 키가 `welcome`, `login`, `guild_boss_battle` **3개뿐**이고, UI 텍스트는 대부분 한국어 하드코딩입니다. `docs/task.md`의 7단계("하드코딩 텍스트 i18n 분리")가 미완 상태와 일치합니다.

### RLS 개방 범위

> **2026-08-07 라이브 DB 재덤프로 확인됨** — 아래는 추정이 아니라 현재 운영 중인 상태입니다.

`mock_battles`와 `union_raid_status`에 `FOR SELECT/INSERT/UPDATE/DELETE TO authenticated USING (true)` 정책이 걸려 있습니다. 즉 **로그인한 사용자라면 길드 소속과 무관하게 타 길드의 보스전 기록을 읽고 수정·삭제할 수 있는 상태**입니다.

이 구조에서는 React 쪽 `isManager(role)` 검사가 방어가 되지 않습니다. 앱은 브라우저에서 DB로 **직접** 접속하고, 그 접속에 쓰는 anon 키는 설계상 JS 번들에 공개되어 있으므로, 콘솔에서 임의의 쿼리를 던질 수 있습니다. **RLS가 사실상 유일한 방어선**입니다.

**핵심 함정 — 정책은 OR로 합쳐집니다.** `union_raid_status`에는 올바른 스코프 정책(`Members can update union_raid_status`)과 `Allow update for all`(`USING (true)`)이 **공존**합니다. Postgres는 같은 테이블·같은 명령의 permissive 정책 중 **하나만 통과해도 허용**하므로, 잘 만든 정책이 무력화됩니다. 정책 추가는 언제나 접근을 *넓히는* 방향입니다.

**대응** — ✅ **운영 DB 적용 완료 (2026-08-10)**. 적용 후 `schema.sql` 재덤프까지 반영됨.

`20260810130000_rls_scope_boss_battle_tables.sql`에 다음을 담았습니다.

| 구분 | 내용 |
| :--- | :--- |
| `mock_battles` | `USING(true)` 4개 제거 → 길드 스코프 `FOR ALL` 정책 1개 |
| `union_raid_status` | `Allow select/update for all` 제거, SELECT 스코프 정책 신규, INSERT/UPDATE 재작성 |
| Realtime | `union_raid_status`에 `REPLICA IDENTITY FULL` — 없으면 DELETE 이벤트에 `union_id`가 없어 정책 평가 불가 → 이벤트 누락 |
| 성능 | `auth.uid()` → `(select auth.uid())` (행별 재평가 → InitPlan 1회), 인덱스 6개 신설 |

**설계 원칙**: 길드 *간* 경계만 세우고 길드 *내부* 동작은 그대로 둡니다. 그래야 적용 후 검증이 "타 길드 차단 / 내 길드 정상" 두 가지로 끝납니다.

**성능 판단**: 멤버십 판정을 `SECURITY DEFINER` 헬퍼 함수로 빼는 방식을 검토했으나 채택하지 않았습니다. `SECURITY DEFINER` 함수는 플래너가 인라인 전개할 수 없어 행마다 함수 호출이 되는 반면, 인라인 `EXISTS`는 `union_members`와의 semi-join으로 변환될 수 있습니다. `union_members`의 `UNIQUE (union_id, user_id)` 인덱스를 그대로 탑니다.

**영향 없음이 확인된 것**: `apply_real_battle_damage` / `revert_real_battle_damage`는 `SECURITY DEFINER`라 RLS를 우회합니다. 모든 INSERT payload에 `union_id`가 포함되어 있고, 모든 읽기 경로가 이미 `union_id`로 필터링되어 있습니다(유일한 예외인 3타 카운트 쿼리는 스코프 적용 시 오히려 교정됨).

### 인증 방식

아이디/비밀번호 가입을 위해 `${username}@nikke.local` 형태의 **더미 이메일**로 Supabase Auth를 사용합니다(`AuthContext.jsx:62`). 이메일 검증·비밀번호 재설정 흐름이 없으므로, 계정 복구는 관리자 개입에 의존합니다.

### 컴포넌트 크기

`MockBattleDashboard.jsx`(1,117줄), `BossBattleDashboard.jsx`(1,059줄), `WorkspaceLayout.jsx`(865줄), `GuildSettings.jsx`(810줄)가 특히 큽니다. 다만 `settings/` 탭 8개, `panels/` 4개, `components/chat/` 9개처럼 **추출이 진행 중인 흔적**이 뚜렷합니다.

### 스타일링

CSS 변수 토큰(`--surface-*`, `--text-*`, `--accent-*`, `--danger-*`)은 `index.css`에 잘 정의되어 있으나, 실제 사용은 **인라인 `style` 객체가 압도적**입니다. 토큰 자체는 인라인에서도 참조하고 있어 테마 일관성은 유지됩니다.

### 잘 되어 있는 점

- 동시성 버그를 **원자적 RPC + 행 잠금**으로 정면 해결하고, 마이그레이션 주석에 배경까지 남김
- Realtime의 실무 함정(백그라운드 스로틀링, `REPLICA IDENTITY`, presence 깜빡임)에 대한 대응이 코드와 주석에 명시
- 채팅 부품·훅·포맷터의 재사용 경계가 명확 (일반/지휘 채팅 완전 공유)
- Edge Function 3종 모두 자체 인증(시크릿 헤더 / RPC / allowlist)을 갖춤
- 체험 모드가 DB 부작용 없이 전 화면에서 동작

---

## 12. 배포 사고 기록 — "자산 자리에 HTML 200"

이 리포지토리에서 **두 번** 발생한 사고이며, 원인이 다르지만 증상과 뿌리는 같습니다.

### 공통 뿌리

`public/_redirects`의 SPA 폴백이 자산 요청까지 받습니다.

```
/*    /index.html   200
```

없는 자산은 **404가 아니라 `200 + text/html`** 로 응답합니다. 브라우저는 모듈 MIME 검사에서 이를 거부해 화면이 통째로 안 뜨는데, **상태 코드가 200이라 네트워크 탭에 빨간 줄조차 안 남습니다.** 여기에 `_headers`가 `/assets/*`에 `immutable`(1년)을 붙이므로, 한 번 잘못 캐시되면 오래 살아남습니다.

### 1차 (2026-08-10, `f2c5479`)

코드 스플리팅 도입 직후. 브라우저가 들고 있던 **낡은 index.html**이 이번 배포로 사라진 번들 파일명을 요청 → 폴백 HTML. 하드 리로드로 해결됨.

대응: `public/_headers`(HTML은 `max-age=0`, 자산은 `immutable`) + `src/lib/lazyRoute.js`(청크 로드 실패 시 1회 자동 리로드, 10초 쿨다운).

### 2차 (2026-08-11)

**크롬·사파리만 워크스페이스 진입 실패, 파이어폭스는 정상.** 훨씬 고약했습니다.

배제된 것들 — 전부 증거로 반박됨:

| 가설 | 반증 |
| :--- | :--- |
| 배포 누락 | 라이브 자산 55개 전수 크롤 → 전부 정상 타입 |
| 브라우저 캐시 | 사이트 데이터 삭제·시크릿창에서도 재현 |
| 서비스워커 | `sw.js`에 `fetch` 핸들러가 존재한 적 없음 |
| 엣지 캐시 / POP | 셀룰러·VPN에서도 재현, `cf-ray`는 서로 같은 POP |
| 확장 프로그램 | 시크릿창에서도 재현 |
| 파일명 키워드 필터 | `Boss`/`BossBattle` 없는 청크도 실패 |
| `_headers` | Cache-Control만 설정 — Content-Type을 바꿀 수 없음 |

결정적 관찰 두 개:

1. **같은 URL에 `fetch()`는 정상 JS, `import()`는 HTML.** (모듈맵은 실패를 문서 생명주기 동안 캐시하므로, 재시도해도 같은 실패가 재생됩니다 — 진단 시 반드시 새 탭에서 확인해야 합니다.)
2. 폴백으로 돌아온 HTML이 **이전 배포본의 엔트리**를 가리켰습니다. 실패한 자산은 정확히 "이전 배포 대비 해시가 바뀐 파일들"이었습니다.

**근본 원인은 특정하지 못했습니다.** 확실한 것은 특정 자산 URL 몇 개가 그 사용자에게만 오염돼 있었고, **재배포로 URL이 전부 새로 발급되자 즉시 해결**됐다는 점입니다.

> `dist`를 비우는 것만으로는 부족합니다. Cloudflare Pages는 이전 배포본의 파일을 계속 서비스하며(클린 재배포 후에도 1차 배포본 엔트리가 200으로 응답했습니다), 같은 소스를 다시 빌드하면 같은 해시 = **같은 URL로 되돌아갑니다.**

### 현재 대응

- **`vite.config.js`** — 파일명에 빌드 식별자(`git short sha` + 타임스탬프)를 섞어 **배포마다 자산 URL이 절대 재사용되지 않게** 합니다. 덕분에 "다시 배포한다"가 언제나 통하는 복구 수단이 됩니다. 대가는 배포마다 자산 캐시가 무효화되는 것(엔트리 gzip 90KB대라 감당 가능). 소스 이름(`[name]`)은 일부러 남깁니다 — 2차 사고에서 `BossImage`·`useBossBattleSeasons` 같은 읽을 수 있는 청크 이름이 범위를 좁히는 결정적 단서였습니다.
- **`npm run build`** — `rm -rf dist`를 선행합니다.
- **`npm run deploy`** — 클린 빌드 → `wrangler pages deploy` → 정합성 검증을 한 번에.
- **`scripts/verify-deploy.mjs`** — 라이브 index.html에서 출발해 참조 자산을 재귀 크롤, JS/CSS 자리에 HTML이 오면 실패 종료. 폴백 HTML이 어느 배포본을 가리키는지도 함께 출력합니다. 전파 지연 오탐을 막기 위해 6초 간격 4회 재시도.

### 남은 개선 여지

폴백이 자산까지 받는 구조 자체는 그대로입니다. `_redirects`의 캐치올을 실제 라우트로 좁히면 없는 자산이 404로 떨어져 이 사고 유형이 원천 차단됩니다. Cloudflare Pages `_redirects`는 **404 상태 코드를 지원하지 않으므로**(301/302/303/307/308/200만) 라우트를 열거하는 방식이어야 하고, 하나라도 빠뜨리면 그 주소 직접 접속이 깨지므로 `App.jsx`의 라우트 테이블과 함께 검토해야 합니다.
