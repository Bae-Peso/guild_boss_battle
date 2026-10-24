// 모의전 "수기 입력"(대리 작성)의 대상 후보 목록.
//
// 배경: 수기 입력은 사이트를 쓰지 않는 길드원이나 외부 용병의 기록을 관리자가 대신 적는
// 기능이라 닉네임을 매번 손으로 쳐야 했다. 오타가 나면 identity.js의 "닉네임이 같으면 동일
// 인물" 규칙이 갈라져 같은 사람의 기록이 두 줄로 보인다. 그래서 길드 로스터와 이미 적혀
// 있는 수기 닉네임을 모아 고를 수 있게 한다. (목록에 없는 사람은 그대로 직접 입력하면 된다)
//
// 싱크로는 "알려진 값 중 가장 높은 것"을 쓴다. mock_battles에는 정렬할 수 있는 작성 시각이
// 없고(id가 uuid, completed_at은 완료 기록에만 있음), 싱크로는 사실상 올라가기만 하므로
// 최댓값이 레코드 순서에 흔들리지 않으면서 가장 최근 값에 가깝다. 사이트를 쓰지 않는 멤버는
// users.synchro_level이 기본값(1)에 머무는 반면 대리 기록에는 실제 레벨이 적혀 있어서,
// 로스터 값만 믿으면 오히려 엉뚱한 레벨이 채워진다. 어차피 폼에서 수정할 수 있는 값이다.

// users 관계는 to-one이라 보통 객체지만, 쿼리에 따라 배열로 올 수 있어 둘 다 지원한다.
// (identity.js의 memberSynchro와 같은 규칙)
function memberSynchro(m) {
  const u = Array.isArray(m?.users) ? m.users[0] : m?.users;
  return u?.synchro_level != null ? Number(u.synchro_level) : null;
}

function higher(a, b) {
  const nums = [a, b].filter((v) => v != null && Number.isFinite(Number(v)));
  if (nums.length === 0) return null;
  return Math.max(...nums.map(Number));
}

// allMembers: union_members 배열 (in_game_name, users.synchro_level)
// records: mock_battles 배열 (수기 기록의 manual_nickname / synchro_level만 본다)
// → [{ name, synchroLevel, isMember }] (로스터 먼저, 그 안에서 가나다순)
export function buildManualTargets(allMembers = [], records = []) {
  const byName = new Map();

  const put = (name, synchroLevel, isMember) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    const prev = byName.get(trimmed);
    byName.set(trimmed, {
      name: trimmed,
      synchroLevel: higher(prev?.synchroLevel, synchroLevel),
      isMember: prev?.isMember || isMember,
    });
  };

  (allMembers || []).forEach((m) => put(m?.in_game_name, memberSynchro(m), true));
  (records || []).forEach((r) => {
    if (!r?.is_admin_written) return;
    put(r.manual_nickname, r.synchro_level, false);
  });

  return Array.from(byName.values()).sort((a, b) => {
    if (a.isMember !== b.isMember) return a.isMember ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });
}

// 입력한 글자로 후보를 좁힌다. 앞에서부터 일치하는 후보를 위로 올린다.
export function filterManualTargets(targets = [], query = '') {
  const q = (query || '').trim().toLowerCase();
  if (!q) return targets;
  return targets
    .filter((t) => t.name.toLowerCase().includes(q))
    .sort((a, b) => {
      const rank = (t) => (t.name.toLowerCase().startsWith(q) ? 0 : 1);
      return rank(a) - rank(b);
    });
}
