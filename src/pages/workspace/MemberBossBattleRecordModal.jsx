import { useMemo } from 'react';
import NikkeAvatar from '../../components/NikkeAvatar';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { usePreferences } from '../../hooks/usePreferences';
import { useGameData } from '../../contexts/GameDataContext';
import { formatHp, formatShortDateTime } from '../../lib/format';
import { makeIdentity } from '../../lib/identity';
import './Settlement.css'; // settlement-badge-last(막타 배지) 공유

const ELEMENT_ICON = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };

const HIT_CAP = 3;

/**
 * 지휘 채팅에서 닉네임/초상화를 클릭했을 때 뜨는, 그 사람의 "해당 시즌" 보스전 기록.
 *
 * 데이터는 지휘 채팅방(BossBattleChatPage)이 보스 현황을 그리려고 이미 받아 둔 것을 그대로 쓴다 —
 * 모달을 열 때 다시 조회하지 않는다.
 *
 * 기록은 identity.js 규칙(닉네임)으로 묶는다. 관리자가 대신 적어준 수기 기록도 닉네임이 같으면
 * 본인 기록과 함께 보인다 — 타수 현황판/결산과 같은 기준.
 */
export default function MemberBossBattleRecordModal({
  seasonName, member, userId, statuses = [], mocks = [], allMembers = [], onClose,
}) {
  useEscapeKey(true, onClose);
  const { hpMode } = usePreferences();
  const { gameIcons } = useGameData();
  const elementIconUrl = (element) =>
    gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;

  const identity = useMemo(() => makeIdentity(allMembers), [allMembers]);

  const hits = useMemo(() => {
    // 이 시즌 보스 단계 정보(보스 이름/속성/단계)를 붙이기 위한 맵
    const statusMap = {};
    statuses.forEach(s => {
      statusMap[s.id] = { ...s.global_raid_bosses, stage_level: s.stage_level };
    });

    // 탈퇴 등으로 로스터에 없으면 identityKey의 '본인 작성' 분기와 같은 규칙(u <user_id>)으로 맞춘다.
    const key = member ? identity.memberIdentityKey(member) : `u ${userId}`;

    return mocks
      .filter(mb => mb.status === 'completed' && statusMap[mb.boss_status_id] && identity.identityKey(mb) === key)
      .sort((a, b) => new Date(a.completed_at || 0) - new Date(b.completed_at || 0))
      .map(mb => ({ ...mb, bossInfo: statusMap[mb.boss_status_id] }));
  }, [mocks, statuses, member, userId, identity]);

  const totalDmg = hits.reduce((sum, h) => sum + Number(h.real_damage || 0), 0);
  const name = member?.in_game_name || '알 수 없음';
  const synchro = member ? (identity.memberSynchro(member) ?? '?') : '?';

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)', zIndex: 10002, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: 'var(--surface-2)', borderRadius: '8px', width: '560px', maxWidth: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--surface-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, color: 'var(--text-strong)', fontSize: '1.05rem', wordBreak: 'break-all' }}>
              {name} <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>Lv.{synchro}</span>
            </h3>
            <div style={{ marginTop: '2px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {seasonName} 길드 보스전 기록
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

        <div style={{ display: 'flex', gap: '10px', padding: '12px 16px', borderBottom: '1px solid var(--surface-1)' }}>
          <div style={{ flex: 1, backgroundColor: 'var(--surface-1)', borderRadius: '6px', padding: '8px 10px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>소모 타수</div>
            <div style={{ fontWeight: 'bold', color: hits.length >= HIT_CAP ? 'var(--danger-bright)' : 'var(--accent-green)' }}>
              {hits.length} / {HIT_CAP}
              <span style={{ marginLeft: '6px', fontSize: '0.78rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>
                {hits.length >= HIT_CAP ? '소진' : `${HIT_CAP - hits.length}타 남음`}
              </span>
            </div>
          </div>
          <div style={{ flex: 1, backgroundColor: 'var(--surface-1)', borderRadius: '6px', padding: '8px 10px', minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>총 대미지</div>
            <div style={{ fontWeight: 'bold', color: 'var(--accent-green)', wordBreak: 'break-all' }}>{formatHp(totalDmg, hpMode)}</div>
          </div>
        </div>

        <div style={{ padding: '14px 16px', overflowY: 'auto' }}>
          {hits.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.9rem', textAlign: 'center', padding: '20px 0' }}>
              이 시즌에 완료한 타수가 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {hits.map((hit, i) => {
                const diff = Number(hit.real_damage || 0) - Number(hit.expected_damage || 0);
                const diffColor = diff > 0 ? 'var(--accent-green)' : (diff < 0 ? 'var(--danger)' : 'var(--text-soft)');
                return (
                  <div key={hit.id} style={{ backgroundColor: 'var(--surface-1)', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', flexShrink: 0 }}>{i + 1}타</span>
                        <span style={{ color: '#93c5fd', fontSize: '0.88rem', fontWeight: 'bold', wordBreak: 'break-all' }}>
                          {hit.bossInfo?.stage_level}단계 {hit.bossInfo?.name}
                        </span>
                        {elementIconUrl(hit.bossInfo?.element)
                          ? <img src={elementIconUrl(hit.bossInfo?.element)} alt={hit.bossInfo?.element} style={{ width: '16px', height: '16px', objectFit: 'contain' }} />
                          : <span style={{ fontSize: '0.85rem' }}>{ELEMENT_ICON[hit.bossInfo?.element] || ''}</span>}
                        {hit.is_last_hit && <span className="settlement-badge-last">막타</span>}
                        {hit.is_admin_written && <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>(수기)</span>}
                      </div>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', flexShrink: 0 }}>
                        {formatShortDateTime(hit.completed_at)}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '14px', marginTop: '8px', flexWrap: 'wrap', fontSize: '0.8rem' }}>
                      <div>
                        <span style={{ color: 'var(--text-dim)' }}>실전 </span>
                        <span style={{ fontWeight: 'bold', color: 'var(--accent-green)' }}>{formatHp(hit.real_damage, hpMode)}</span>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-dim)' }}>모의 </span>
                        <span style={{ color: 'var(--text-soft)' }}>{formatHp(hit.expected_damage, hpMode)}</span>
                      </div>
                      {/* 부호는 앞에 한 번만 — 뒤 괄호의 비율까지 부호를 달면 '−… (-0.7%)'처럼 겹친다 */}
                      <div style={{ color: diffColor }}>
                        {diff >= 0 ? '+' : '−'}{formatHp(Math.abs(diff), hpMode)}
                        {Number(hit.expected_damage) > 0 && (
                          <span style={{ marginLeft: '4px' }}>
                            ({Math.abs((diff / Number(hit.expected_damage)) * 100).toFixed(1)}%)
                          </span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '2%', marginTop: '8px', width: '100%' }}>
                      {[hit.slot_1_nikke_id, hit.slot_2_nikke_id, hit.slot_3_nikke_id, hit.slot_4_nikke_id, hit.slot_5_nikke_id].map((nid, s) => (
                        <NikkeAvatar key={s} nikkeId={nid} size="18%" style={{ aspectRatio: '1/1' }} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
