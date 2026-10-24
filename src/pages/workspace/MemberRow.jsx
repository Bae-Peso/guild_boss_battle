// 좌측 사이드바의 멤버 한 줄(아바타 + 닉네임/직책/동기화 + 상태메시지).
// 온라인/오프라인 목록이 동일 마크업을 쓰므로 online 플래그로 통합한다.
export default function MemberRow({ member: m, online, profileImagesMap }) {
  const imgUrl = m.users?.profile_image_id ? profileImagesMap[m.users.profile_image_id] : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', padding: '4px', opacity: online ? 1 : 0.5 }}>
      <div style={{ position: 'relative' }}>
        {imgUrl ? (
          <img src={imgUrl} alt={m.in_game_name} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover', opacity: online ? 1 : 0.5 }} />
        ) : (
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: online ? 'var(--accent-blue)' : 'var(--border-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-strong)', fontWeight: 'bold', fontSize: '0.9rem' }}>
            {m.in_game_name.charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ position: 'absolute', bottom: -2, right: -2, width: '10px', height: '10px', borderRadius: '50%', backgroundColor: online ? 'var(--accent-green)' : 'var(--text-dim)', border: '2px solid var(--surface-2)' }}></div>
      </div>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <div style={{ color: 'var(--text-strong)', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.in_game_name}
          {m.role === 'admin' && <span style={{ marginLeft: '4px' }}>🟧</span>}
          {m.role === 'sub_admin' && <span style={{ marginLeft: '4px' }}>🟦</span>}
          {m.users?.synchro_level && <span style={{ marginLeft: '4px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>({m.users.synchro_level})</span>}
        </div>
        {m.status_message && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {m.status_message}
          </div>
        )}
      </div>
    </div>
  );
}
