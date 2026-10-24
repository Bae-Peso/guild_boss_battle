# 니케 길드 전용 웹페이지 데이터베이스 스키마 설계도

본 설계는 확장성과 데이터 무결성을 고려하여 작성된 관계형 데이터베이스(PostgreSQL) 구조입니다. 
*모든 테이블의 기본키(id)는 고유 식별자인 UUID를 사용합니다.*

## 1. 계정 및 시스템 권한

### `SiteAdmins` (최고 관리자)
사이트 전체를 관리하는 최고 관리자 전용 테이블입니다. 일반 유저 테이블과 분리하여 보안을 강화합니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 고유 식별자 |
| `user_id` | UUID (FK) | Supabase Auth의 내부 유저 ID |
| `is_active` | Boolean | 권한 활성화 여부 (True/False) |
| `grant_reason` | String | 권한 부여 사유 |
| `revoke_reason`| String | (해제 시) 권한 해제 사유 |
| `created_at` | Timestamp | 관리자 권한 부여 일시 |
| `revoked_at` | Timestamp | 관리자 권한 해제 일시 |

### `Users` (글로벌 유저 기본 정보)
유저의 로그인 정보와 **변하지 않는 고유 정보(UID)**를 관리합니다. 악성 유저 차단(블랙리스트)의 기준이 됩니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | Supabase Auth 유저 고유 ID |
| `username` | String | 로그인에 사용하는 고유 아이디 |
| `uid` | String | 인게임 고유 번호 UID (계정당 1개 고정, 밴 기록 추적용) |
| `global_ban_reason` | String | 사이트 최고 관리자 전용 밴 사유 메모 |
| `created_at` | Timestamp | 계정 생성 일시 |

## 2. 길드 및 멤버 관리

### `GuildMembers` (길드별 소속 인원 정보)
유저의 제안에 따라, 특정 길드 내에서의 활동 정보(상태 메시지, 진입 여부, 닉네임 등)를 별도로 분리하여 관리하는 테이블입니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 멤버 정보 고유 식별자 |
| `union_id` | UUID (FK) | 소속된 길드 ID |
| `user_id` | UUID (FK) | Users 테이블의 유저 ID |
| `in_game_name` | String | 해당 길드 활동 시 사용하는 인게임 닉네임 |
| `role` | Enum | 길드 내 권한 (`member`, `sub_admin`, `admin`) |
| `join_status` | Enum | 가입 상태 (`pending`, `approved`, `banned`) |
| `status_message` | String | 접속 가능 시간 등 길드 내 상태 메시지 |
| `in_battle_boss_id` | UUID (FK) | 현재 타격 중인 보스 현황판 ID (없으면 Null) |

### `Unions` (길드 정보)
각 길드의 기본 정보를 담고 있습니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 길드 내부 고유 식별자 |
| `union_code` | String | 유저가 가입 신청 시 검색할 고유 코드 (예: NK2024) |
| `name` | String | 길드 명 |
| `server_region`| Enum | 서버 소속 (`KR` 한국, `JP` 일본, `Global` 글로벌, `NA` 북미, `SEA` 동남아) |
| `description` | String | 길드 한 줄 소개 |
| `status` | Enum | 사이트 관리자의 승인 상태 (`pending`, `approved`, `banned`) |
| `owner_id` | UUID (FK) | 길드를 총괄하는 총 관리자의 User ID |
| `log_retention_days`| Integer | 활동 로그(AuditLogs) 자동 삭제 기간 (예: 30. Null/0일 경우 무기한 보관) |

### `AuditLogs` (시스템 및 길드 활동 로그)
최고 관리자가 특정 길드의 이슈를 파악하거나 분쟁을 조정하기 위해 열람하는 활동 기록입니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 로그 고유 ID |
| `union_id` | UUID (FK) | 관련된 길드 ID (글로벌 시스템 로그일 경우 Null) |
| `actor_id` | UUID (FK) | 행위를 수행한 유저 ID (Users 테이블) |
| `action_type` | Enum | 로그 유형 (`join`, `leave`, `ban`, `role_change`, `admin_transfer` 등) |
| `description` | Text | 상세 설명 (예: "A유저가 B유저를 차단함") |
| `created_at` | Timestamp | 발생 일시 |

### `Reports` (신고 및 건의 접수)
유저가 제출한 사이트 버그, 기능 건의, 혹은 불량 유저(분탕, 도주 등) 신고 내역을 사이트 관리자가 처리하는 테이블입니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 신고/건의 고유 ID |
| `reporter_id` | UUID (FK) | 신고자/건의자의 User ID |
| `target_user_id` | UUID (FK) | (신고일 경우) 피신고자의 User ID (선택사항) |
| `type` | Enum | 대분류 (`report`: 신고, `suggestion`: 건의) |
| `category` | Enum | 소분류 (신고: `욕설`, `분탕`, `도주` 등 / 건의: `버그`, `기능추가` 등) |
| `content` | Text | 상세 내용 |
| `status` | Enum | 처리 상태 (`pending`: 대기, `approved`: 승인, `completed`: 완료, `rejected`: 거절) |
| `admin_notes` | Text | 관리자 전용 메모 (처리 사유 등 비공개 메모) |
| `created_at` | Timestamp | 접수 일시 |

## 3. 실시간 채팅

### `Channels` (채팅 채널)
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 채널 고유 ID |
| `union_id` | UUID (FK) | 이 채널이 속한 길드 ID |
| `name` | String | 채팅 채널 이름 |
| `type` | Enum | 채널 속성 (`general`:일반, `notice`:공지, `admin_only`:관리자용, `raid_order`:오더용) |
| `is_fixed` | Boolean | 삭제 및 이름 변경 불가 여부 (보스전 오더 채널은 True) |
| `deleted_at` | Timestamp | 채널 삭제 일시 (소프트 삭제용. 30일 후 실제 완전 삭제) |

### `Messages` (채팅 메시지 내역)
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 메시지 고유 ID |
| `channel_id` | UUID (FK) | 메시지가 작성된 채널 ID |
| `user_id` | UUID (FK) | 작성자 User ID |
| `content` | Text | 텍스트 내용 |
| `image_url` | String | 업로드된 이미지의 외부 스토리지 링크 |
| `created_at` | Timestamp | 작성 일시 (이 기준으로 정렬하여 불러옴) |

## 4. 길드 보스전 (테트리스 지휘)

### `GlobalBossBattleBosses` (보스 기초 정보 - 최고관리자용)
보스전 시즌마다 변하는 전체 보스의 원본 스펙입니다. 사이트 소유자가 한 번만 입력합니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 글로벌 보스 고유 ID |
| `season_name` | String | 보스전 시즌명 |
| `difficulty` | Enum | 난이도 (`normal`, `hard`) |
| `level` | Integer | 단계 (하드 1단계, 2단계 등) |
| `element` | Enum | 속성 (작열, 수냉, 풍압, 전격, 철갑) |
| `name` | String | 보스 이름 |
| `max_hp` | BigInt | 해당 단계 보스의 전체 최대 체력 |

### `GuildBossBattleStatus` (길드별 보스 현황판 - 길드관리자용)
글로벌 보스 정보를 바탕으로, '우리 길드'이 현재 얼마나 깎았는지를 기록하는 현황판입니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 현황판 고유 ID |
| `union_id` | UUID (FK) | 해당 길드 ID |
| `global_boss_id` | UUID (FK) | 타겟이 되는 원본 보스 ID |
| `current_hp` | BigInt | 수동으로 갱신하는 실제 남은 체력 |
| `is_cleared` | Boolean | 격파 완료 여부 |

### `MockBattles` (모의전 기록 및 딜량 테트리스)
유저들이 입력하고, 관리자가 테트리스 계산에 활용하는 데이터 모음입니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 기록 고유 ID |
| `union_id` | UUID (FK) | 소속 길드 ID |
| `user_id` | UUID (FK) | 모의전을 친 유저 ID |
| `boss_status_id` | UUID (FK) | 어떤 보스(GuildBossBattleStatus)를 상대로 친 것인지 |
| `deck_info` | String | 니케 조합 텍스트 (선택 입력사항) |
| `expected_damage` | BigInt | 예상 딜량 (필수 입력사항) |
| `status` | Enum | 모의전 기록의 소모 여부 (`pending`:대기중, `completed`:실제 타수로 소모 완료) |
| `real_damage` | BigInt | 실전 완료 후 본인이 직접 기입한 실제 딜량 |
| `is_last_hit` | Boolean | 막타(보스 체력을 0으로 만든 타수) 여부 (True/False) |
| `completed_at` | Timestamp | 실제 타수 소모(완료 처리)가 기록된 일시 |
| `slot_1_nikke_id` | UUID (FK) | (선택) 참전 니케 1번 자리 ID |
| `slot_2_nikke_id` | UUID (FK) | (선택) 참전 니케 2번 자리 ID |
| `slot_3_nikke_id` | UUID (FK) | (선택) 참전 니케 3번 자리 ID |
| `slot_4_nikke_id` | UUID (FK) | (선택) 참전 니케 4번 자리 ID |
| `slot_5_nikke_id` | UUID (FK) | (선택) 참전 니케 5번 자리 ID |
| `memo` | String | (선택) 기록 작성자가 남기는 메모 (기록 표에 📝 배지로 표시) |

### `Nikkes` (니케 캐릭터 마스터 데이터)
사이트 전체에서 공통으로 참조하는 인게임 캐릭터 데이터베이스입니다. (제공된 데이터 시트 기준)
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | Integer (PK) | 순번 (1~190 등) |
| `release_date` | Date | 출시일 (yyyy-mm-dd) |
| `name` | String | 니케명 (한글) |
| `manufacturer` | Enum | 소속 기업 (엘리시온, 미실리스, 테트라, 필그림, 앱노멀) |
| `is_overspec` | Boolean | 오버스펙 여부 |
| `grade` | Enum | 등급 (`R`, `SR`, `SSR`) |
| `class_type` | Enum | 클래스 (`공격형`, `지원형`, `방어형`) |
| `burst_type` | Integer (bitmask) | 버스트 (1=1단, 2=2단, 4=3단의 합, 예: 5 = 1·3단 가능, 7 = 전체 가능) |
| `burst_cooldown` | Integer | 버스트 재사용 대기 시간 (초) (예: 20, 40) |
| `element` | Enum | 코드/속성 (`작열`, `수냉`, `풍압`, `전격`, `철갑`) |
| `weapon_type` | Enum | 무기 (`SR`, `SMG`, `AR`, `RL`, `MG`, `SG`) |
| `has_favorite_item`| Boolean | 애장품 보유 여부 |
| `is_alt_version` | Boolean | 이격(다른 버전) 여부 |
| `is_limited` | Boolean | 한정 캐릭터 여부 |
| `image_url` | String | 1:1 정방형 얼굴 이미지 URL 경로 |

### `RecommendedSquads` (길드 추천 스쿼드)
길드 관리자가 시즌/보스별로 설정해두는 추천 덱 데이터입니다.
| 컬럼명 | 데이터 타입 | 설명 |
| :--- | :--- | :--- |
| `id` | UUID (PK) | 추천 스쿼드 ID |
| `union_id` | UUID (FK) | 소속 길드 ID |
| `season_name` | String | 시즌 이름 (예: `24년 6월 보스전`) |
| `boss_number` | Integer | 타겟 보스 번호 (1~5) |
| `name` | String | 스쿼드 이름 (예: `앨리스 관통덱`) |
| `slot_1_nikke_id` | UUID (FK) | 1번 자리 니케 ID |
| `slot_2_nikke_id` | UUID (FK) | 2번 자리 니케 ID |
| `slot_3_nikke_id` | UUID (FK) | 3번 자리 니케 ID |
| `slot_4_nikke_id` | UUID (FK) | 4번 자리 니케 ID |
| `slot_5_nikke_id` | UUID (FK) | 5번 자리 니케 ID |
| `created_by` | UUID (FK) | 작성자(관리자) ID |
