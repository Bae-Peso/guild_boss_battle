import { groupReactions } from '../../lib/reactions';

// 메시지 아래에 붙는 반응 칩들 (일반/지휘 채팅 공용).
// 칩 하나 = 이모지 하나 + 누른 사람 수. 누가 눌렀는지는 칩 툴팁(title)에 이름으로 적는다.
// 내가 누른 칩은 강조되고, 다시 누르면 취소된다.
export default function MessageReactions({ rows, currentUserId, getName, onToggle, align = 'left' }) {
  const groups = groupReactions(rows, currentUserId);
  if (groups.length === 0) return null;

  return (
    <div className={`chat-reactions${align === 'right' ? ' is-right' : ''}`}>
      {groups.map(g => {
        const names = g.userIds.map(getName).join(', ');
        return (
          <button
            key={g.emoji}
            type="button"
            className={`chat-reaction${g.mine ? ' is-mine' : ''}`}
            title={`${g.emoji} ${names}`}
            aria-label={`${g.emoji} 반응 ${g.count}명: ${names}`}
            aria-pressed={g.mine}
            disabled={!onToggle}
            onClick={(e) => { e.stopPropagation(); onToggle?.(g.emoji); }}
          >
            <span className="chat-reaction__emoji">{g.emoji}</span>
            <span className="chat-reaction__count">{g.count}</span>
          </button>
        );
      })}
    </div>
  );
}
