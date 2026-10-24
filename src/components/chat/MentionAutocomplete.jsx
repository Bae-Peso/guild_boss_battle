// 멘션(@) 입력 시 뜨는 멤버 자동완성 드롭다운. (일반/지휘 채팅 공용)
export default function MentionAutocomplete({ members, activeIndex, onPick, onHover, profileImagesMap, leftOffset = '1.5rem' }) {
  if (!members || members.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: leftOffset,
      width: '250px',
      backgroundColor: 'var(--surface-1)',
      borderRadius: '8px',
      boxShadow: '0 -4px 10px rgba(0,0,0,0.3)',
      marginBottom: '10px',
      overflow: 'hidden',
      zIndex: 10
    }}>
      {members.slice(0, 5).map((m, idx) => {
        const imgId = m.users?.profile_image_id;
        const imgUrl = imgId ? profileImagesMap?.[imgId] : null;
        return (
          <div
            key={m.user_id}
            style={{ padding: '10px 15px', backgroundColor: idx === activeIndex ? 'var(--surface-4)' : 'transparent', color: 'var(--text-strong)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
            onClick={() => onPick(m)}
            onMouseEnter={() => onHover(idx)}
          >
            {imgUrl ? (
              <img
                src={imgUrl}
                alt="프로필"
                style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover' }}
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="%234dabf7"/><text x="12" y="16" font-family="sans-serif" font-size="12" fill="white" text-anchor="middle">' + m.in_game_name.charAt(0).toUpperCase() + '</text></svg>';
                }}
              />
            ) : (
              <div style={{ width: '24px', height: '24px', borderRadius: '50%', backgroundColor: 'var(--accent-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 'bold' }}>
                {m.in_game_name.charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ fontSize: '0.85rem' }}>{m.in_game_name}</div>
          </div>
        );
      })}
    </div>
  );
}
