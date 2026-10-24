// 보스전 HP / 딜량 표기 공용 포맷터.
// mode: 'simple' → 억 단위 소수 첫째 자리(예: 1921.7억), 'detail' → 천단위 콤마.
export function formatHp(value, mode = 'detail') {
  const n = Number(value || 0);
  if (mode === 'simple') {
    return (n / 100000000).toFixed(1) + '억';
  }
  return n.toLocaleString();
}

// 한국어 단위(조/억/만)로 분해해 정수로 표시. 0인 단위는 생략한다.
// 예: 1,960,840,000,000 → "1조 9608억 4000만"
export function formatHpUnits(value) {
  let n = Math.floor(Number(value || 0));
  if (n === 0) return '0';
  const neg = n < 0;
  n = Math.abs(n);
  const jo = Math.floor(n / 1e12); n %= 1e12;
  const eok = Math.floor(n / 1e8); n %= 1e8;
  const man = Math.floor(n / 1e4); n %= 1e4;
  const parts = [];
  if (jo) parts.push(`${jo}조`);
  if (eok) parts.push(`${eok}억`);
  if (man) parts.push(`${man}만`);
  if (n) parts.push(`${n}`);
  return (neg ? '-' : '') + parts.join(' ');
}

// 조 단위까지 살린 간이 표기: "1조 9217.3억" / "998.6억" (억은 항상 소수 1자리).
export function formatHpJoEok(value) {
  const n = Number(value || 0);
  const neg = n < 0;
  const abs = Math.abs(n);
  let jo = Math.floor(abs / 1e12);
  let eok = Math.round(((abs - jo * 1e12) / 1e8) * 10) / 10;
  if (eok >= 10000) { jo += 1; eok = 0; }   // 반올림 자리올림(9999.96억 → 1조)
  const sign = neg ? '-' : '';
  if (jo === 0) return `${sign}${eok.toFixed(1)}억`;
  return eok === 0 ? `${sign}${jo}조` : `${sign}${jo}조 ${eok.toFixed(1)}억`;
}

// 간단 표기: 조 이상이면 "X조 Y억"(정수, 소수점 없음), 미만이면 "Y.Z억"(소수 1자리).
// 예: 1,234,500,000,000 → "1조 2345억", 99,856,279,200 → "998.6억"
export function formatHpShort(value) {
  const n = Math.floor(Number(value || 0));
  const neg = n < 0;
  const abs = Math.abs(n);
  if (abs >= 1e12) {
    const jo = Math.floor(abs / 1e12);
    const eok = Math.floor((abs % 1e12) / 1e8);
    return (neg ? '-' : '') + (eok ? `${jo}조 ${eok}억` : `${jo}조`);
  }
  return (n / 1e8).toFixed(1) + '억';
}

// 결산 표에 들어가는 짧은 일시 표기. 예: "08/03 21:14"
export function formatShortDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd} ${hh}:${mi}`;
}

// 경과 시간(ms)을 가장 큰 두 단위까지만 표기. 예: "2일 3시간", "5시간 12분", "43분"
export function formatDurationShort(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}일 ${h}시간` : `${d}일`;
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  return `${m}분`;
}

// 채팅 날짜 구분선용 유틸.
export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

// 연속 메시지에 hover 했을 때 프로필 자리(좁은 여백)에 표시할 시간.
// "오후 3:24" 는 폭을 넘기므로 24시간 HH:MM 로 고정한다.
export function formatChatTimeShort(dateStr) {
  const d = new Date(dateStr);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDateSeparator(dateStr) {
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}년 ${mm}월 ${dd}일`;
}
