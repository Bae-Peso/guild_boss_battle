// 운영자 연락처 링크. 배포 환경마다 다르므로 환경변수로 주입한다 (.env.example 참고).
// 값이 없으면 '#'으로 두어 링크만 비활성화된다.
const env = import.meta.env;

export const CONTACT_URL = env.VITE_CONTACT_URL || '#';
export const REPORT_URL = env.VITE_REPORT_URL || '#';
export const GUILD_APPLY_URL = env.VITE_GUILD_APPLY_URL || '#';
export const OPERATOR_NAME = env.VITE_OPERATOR_NAME || 'Guild BossBattle';
