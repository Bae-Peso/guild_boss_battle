import NikkeAvatar from '../../components/NikkeAvatar';
import SquadMemoBadge from './SquadMemoBadge';
import { useEscapeKey } from '../../hooks/useEscapeKey';

/**
 * 보스 정보 모달.
 * 지휘 현황판·지휘 채팅방에서 보스 이름을 클릭하면 뜬다. 모의전 탭에 등록된 그 보스의
 * 보스 메모와 관리자 추천 덱을 그대로 보여준다 — 타수를 배치하는 도중에 탭을 오가지 않게 하려는 것.
 * 메모/추천 덱의 등록·수정은 기존대로 모의전 탭에서만 한다.
 *
 * onAddMockBattle을 주면 하단에 '모의전 기록 추가' 버튼이 붙는다(지휘 채팅방에서 사용).
 * 안 주면 예전처럼 읽기 전용 — 지휘 현황판은 보스 칸마다 업로드 버튼이 따로 있어 필요 없다.
 */
export default function BossInfoModal({ boss, memo, squads = [], getMemberName, isNarrow, onAddMockBattle, onClose }) {
  useEscapeKey(true, onClose);
  if (!boss) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', width: '520px', maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--surface-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, color: 'var(--text-strong)', fontSize: '1.05rem', wordBreak: 'break-all' }}>{boss.name}</h3>
            <div style={{ marginTop: '2px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              약점 속성: {boss.element}{boss.boss_grade ? ` · ${boss.boss_grade}` : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.3rem', flexShrink: 0 }}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '16px', overflowY: 'auto' }}>
          <h4 style={{ margin: '0 0 8px', color: 'var(--text-strong)', fontSize: '0.95rem' }}>보스 메모</h4>
          <div style={{ backgroundColor: 'var(--surface-1)', padding: '12px', borderRadius: '8px', marginBottom: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, fontSize: '0.9rem', color: memo ? 'var(--text-strong)' : 'var(--text-dim)' }}>
            {memo || '등록된 메모가 없습니다.'}
          </div>

          <h4 style={{ margin: '0 0 8px', color: 'var(--text-strong)', fontSize: '0.95rem' }}>관리자 추천 덱</h4>
          {squads.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.9rem' }}>등록된 추천 덱이 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {squads.map(s => (
                <div key={s.id} style={{ backgroundColor: 'var(--surface-1)', padding: '12px', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ minWidth: 0, wordBreak: 'break-all' }}>
                      <span style={{ fontWeight: 'bold', color: 'var(--text-strong)' }}>{s.name}</span>
                      {s.created_by && getMemberName && (
                        <span style={{ marginLeft: '6px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                          {getMemberName(s.created_by)}
                        </span>
                      )}
                    </div>
                    <div style={{ flexShrink: 0 }}>
                      <SquadMemoBadge memo={s.memo} isNarrow={isNarrow} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                    {[s.slot_1_nikke_id, s.slot_2_nikke_id, s.slot_3_nikke_id, s.slot_4_nikke_id, s.slot_5_nikke_id]
                      .filter(Boolean)
                      .map((nid, i) => <NikkeAvatar key={i} nikkeId={nid} size={48} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 추천 덱을 보다가 그대로 등록으로 넘어갈 수 있게, 액션은 스크롤 영역 밖에 고정한다. */}
        {onAddMockBattle && (
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--surface-1)', flexShrink: 0 }}>
            <button
              onClick={onAddMockBattle}
              style={{ width: '100%', padding: '10px', backgroundColor: 'var(--accent-blurple)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.95rem' }}
            >
              모의전 기록 추가
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
