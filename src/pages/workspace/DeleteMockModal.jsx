// 모의전 기록 삭제 확인 모달. (지휘 현황판 / 모의전 탭 공용)
// onExcludeFromBoard 가 있으면 '대기열에서만 제외' 버튼도 노출한다.
// supabase 처리는 부모가 콜백으로 주입한다.
export default function DeleteMockModal({
  visible,
  title = '모의전 기록 삭제',
  description = '해당 기록을 어떻게 처리하시겠습니까?',
  onExcludeFromBoard,
  onFullDelete,
  fullDeleteLabel = '모의전 기록 완전 삭제 (복구 불가)',
  onCancel,
}) {
  if (!visible) return null;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10001 }}>
      <div style={{ backgroundColor: 'var(--surface-2)', padding: '20px', borderRadius: '8px', maxWidth: '400px', width: '100%', textAlign: 'center' }}>
        <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>{title}</h3>
        <p style={{ color: 'var(--text-soft)', marginBottom: '20px', fontSize: '0.9rem' }}>{description}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {onExcludeFromBoard && (
            <button
              onClick={onExcludeFromBoard}
              style={{ padding: '12px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              지휘 현황판(대기열)에서만 제외
            </button>
          )}
          <button
            onClick={onFullDelete}
            style={{ padding: '12px', background: 'var(--danger)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            {fullDeleteLabel}
          </button>
          <button
            onClick={onCancel}
            style={{ padding: '12px', background: 'transparent', color: 'var(--text-dim)', border: '1px solid var(--border-1)', borderRadius: '4px', cursor: 'pointer', marginTop: '10px' }}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
