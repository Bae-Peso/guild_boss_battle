// 같은 인물의 모의전/타수 기록을 "닉네임"으로 합치기 위한 식별 도구.
//
// 배경: 한 유저의 기록이라도 본인이 직접 작성하면 user_id 기준, 관리자가 수기(대리)로
// 입력하면 manual_nickname 기준으로 저장되어 서로 다른 인물처럼 갈라져 보였다.
// 이를 방지하기 위해, "닉네임이 같으면 동일 인물"로 취급한다.
//
// - 본인 작성 기록(is_admin_written = false): 작성자(user_id)의 멤버 정보에서 현재 닉네임을
//   가져와 식별한다. (한 멤버의 기록은 항상 하나로 묶인다)
// - 수기 기록(is_admin_written = true): 입력된 manual_nickname으로 식별한다.
//   같은 닉네임의 멤버가 있으면 그 멤버의 기록과 자동으로 합쳐진다.
//
// 예전에는 키에 싱크로 레벨까지 넣었으나, 대리 입력 멤버는 users.synchro_level이 갱신되지 않아
// 시즌이 지날수록 같은 사람의 기록이 싱크로 차이로 갈라졌다. 한 길드 안에서 닉네임은
// 사실상 유일하므로 닉네임만으로 식별한다. (싱크로는 표시용으로만 쓴다 — synchroOf 참고)
//
// allMembers: union_members 배열 (user_id, in_game_name, users.synchro_level 포함)

// 키 구분자.
const SEP = ' ';

// users 관계는 to-one이라 보통 객체지만, 일부 쿼리에선 배열로 올 수 있어 둘 다 지원한다.
function memberSynchro(m) {
  const u = Array.isArray(m?.users) ? m.users[0] : m?.users;
  return u?.synchro_level != null ? Number(u.synchro_level) : null;
}

export function makeIdentity(allMembers) {
  const membersById = new Map();
  (allMembers || []).forEach((m) => {
    membersById.set(m.user_id, m);
  });

  const nameKey = (name) => `n${SEP}${(name || '').trim()}`;

  // 기록의 표시용 닉네임
  const nameOf = (mb) => {
    if (mb.is_admin_written) return (mb.manual_nickname || '').trim();
    const m = membersById.get(mb.user_id);
    return (m?.in_game_name || '').trim();
  };

  // 기록의 표시/식별용 싱크로 (본인 작성은 멤버의 현재 싱크로 기준)
  const synchroOf = (mb) => {
    if (mb.is_admin_written) return mb.synchro_level != null ? Number(mb.synchro_level) : null;
    const m = membersById.get(mb.user_id);
    return memberSynchro(m) ?? (mb.synchro_level != null ? Number(mb.synchro_level) : null);
  };

  // 그룹 식별 키. 닉네임으로 묶되, 본인 작성인데 멤버를 못 찾으면(탈퇴 등) user_id로 개별
  // 취급해 서로 다른 미확인 유저가 뭉치지 않게 한다.
  // 수기 기록(is_admin_written)은 적힌 닉네임 그대로 쓴다 — 같은 닉네임의 멤버가 로스터에
  // 있으면 자연스럽게 그 멤버의 기록과 합쳐지고, 없으면 외부인으로 별도 행이 된다.
  const identityKey = (mb) => {
    if (!mb.is_admin_written) {
      const m = membersById.get(mb.user_id);
      if (!m) return `u${SEP}${mb.user_id}`;
      return nameKey(m.in_game_name);
    }
    return nameKey(mb.manual_nickname);
  };

  // 로스터(멤버)에서 바로 만드는 식별 키 — 위 identityKey의 본인 작성 분기와 동일 규칙.
  const memberIdentityKey = (m) => nameKey(m.in_game_name);

  return { identityKey, memberIdentityKey, nameOf, synchroOf, memberSynchro, membersById };
}
