// 메시지 반응(이모지) 공용 로직 — 일반 채팅 / 지휘 채팅에서 함께 쓴다.

// 시험 도입 단계라 세 가지만 둔다.
// emoji 값이 그대로 DB(message_reactions.emoji)에 저장되므로, 늘리는 건 자유롭지만
// 이미 쓰인 값을 바꾸면 과거 반응이 짝을 잃는다.
export const REACTION_EMOJIS = [
  { emoji: '✅', label: '체크' },
  { emoji: '❤️', label: '하트' },
  { emoji: '❌', label: 'X' },
  { emoji: '❓', label: '물음표' },
];

const ORDER = new Map(REACTION_EMOJIS.map((r, i) => [r.emoji, i]));

/**
 * 한 메시지의 반응 행들을 이모지별로 묶는다.
 * → [{ emoji, count, mine, userIds }]  (userIds 는 누른 순서 = 표시할 이름 순서)
 * 순서는 REACTION_EMOJIS 기준으로 고정한다 — 누를 때마다 칩이 자리를 바꾸면
 * 연타로 껐다 켰다 하기 어렵다. 목록에서 빠진(예전에 쓰던) 이모지는 뒤에 붙인다.
 */
export function groupReactions(rows, currentUserId) {
  if (!rows || rows.length === 0) return [];

  const byEmoji = new Map();
  [...rows]
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .forEach(r => {
      let g = byEmoji.get(r.emoji);
      if (!g) {
        g = { emoji: r.emoji, count: 0, mine: false, userIds: [] };
        byEmoji.set(r.emoji, g);
      }
      g.count += 1;
      g.userIds.push(r.user_id);
      if (r.user_id === currentUserId) g.mine = true;
    });

  const known = (e) => (ORDER.has(e) ? ORDER.get(e) : ORDER.size);
  return [...byEmoji.values()].sort((a, b) => known(a.emoji) - known(b.emoji));
}
