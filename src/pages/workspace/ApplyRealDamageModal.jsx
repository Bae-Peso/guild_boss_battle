import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { useDemo } from '../../demo/DemoContext';
import { useGameData } from '../../contexts/GameDataContext';
import { formatHp } from '../../lib/format';

export default function ApplyRealDamageModal({ isOpen, onClose, mockBattle, bossStatus, onApplyComplete, isInfinite = false }) {
  useEscapeKey(isOpen, onClose);
  const demo = useDemo();
  const { nikkes: allNikkes } = useGameData();
  const [hpMode, setHpMode] = useState('detail');
  const [actualDamage, setActualDamage] = useState('');
  const [isLastHit, setIsLastHit] = useState(false);
  const [nikkes, setNikkes] = useState([null, null, null, null, null]);

  useEffect(() => {
    if (!isOpen || !mockBattle) return;
    
    // reset state
    setActualDamage('');
    setIsLastHit(false);

    const slotIds = [
      mockBattle.slot_1_nikke_id,
      mockBattle.slot_2_nikke_id,
      mockBattle.slot_3_nikke_id,
      mockBattle.slot_4_nikke_id,
      mockBattle.slot_5_nikke_id
    ];

    // 체험 모드: 이미 로드된 전역 니케 데이터에서 매칭 (네트워크 호출 없음)
    if (demo.isDemo) {
      setNikkes(slotIds.map(id => (id ? (allNikkes || []).find(n => n.id === id) || null : null)));
      return;
    }

    const fetchNikkes = async () => {
      const nikkeIds = slotIds.filter(Boolean);

      if (nikkeIds.length > 0) {
        const { data } = await supabase.from('nikkes').select('*').in('id', nikkeIds);
        if (data) {
          setNikkes([
            data.find(n => n.id === mockBattle.slot_1_nikke_id) || null,
            data.find(n => n.id === mockBattle.slot_2_nikke_id) || null,
            data.find(n => n.id === mockBattle.slot_3_nikke_id) || null,
            data.find(n => n.id === mockBattle.slot_4_nikke_id) || null,
            data.find(n => n.id === mockBattle.slot_5_nikke_id) || null
          ]);
        }
      }
    };
    fetchNikkes();
  }, [isOpen, mockBattle, demo.isDemo, allNikkes]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!actualDamage && !isLastHit) {
      return alert('실제 대미지를 입력해주세요.');
    }

    let finalDamage = 0;
    if (hpMode === 'simple' && !isLastHit) {
      finalDamage = Math.round(parseFloat(actualDamage) * 100000000);
      if (isNaN(finalDamage)) return alert('정상적인 수치를 입력해주세요. (예: 3.2)');
    } else if (!isLastHit) {
      finalDamage = parseInt(actualDamage.replace(/,/g, ''), 10);
      if (isNaN(finalDamage)) return alert('정상적인 수치를 입력해주세요.');
    }

    // 체험 모드: DB 검증/쓰기 없이 스토어에 로컬 반영 (막타면 클리어)
    if (demo.isDemo) {
      const currentHp = Number(bossStatus.current_hp);
      // 무한(4단계) 보스: 막타/클리어 없이 체력을 누적(+)한다.
      if (isInfinite) {
        demo.applyRealDamage({
          mockBattleId: mockBattle.id,
          bossStatusId: bossStatus.id,
          realDamage: finalDamage,
          subtract: -finalDamage, // current_hp - (-finalDamage) = 누적
          isLastHit: false,
        });
        alert('실전 타수가 적용되었습니다!');
        onApplyComplete();
        return;
      }
      if (!isLastHit && finalDamage >= currentHp) {
        alert('실제 체력을 초과한 대미지를 입력하였습니다.\n막타의 경우 하단의 체크 버튼을 이용해주세요.');
        return;
      }
      const realDamageRecorded = isLastHit ? Math.max(0, currentHp) : finalDamage;
      const subtractAmount = isLastHit ? Number(mockBattle.expected_damage) : finalDamage;
      demo.applyRealDamage({
        mockBattleId: mockBattle.id,
        bossStatusId: bossStatus.id,
        realDamage: realDamageRecorded,
        subtract: subtractAmount,
        isLastHit,
      });
      alert('실전 타수가 적용되었습니다!');
      onApplyComplete();
      return;
    }

    // 체력 반영은 원자적 RPC(apply_real_battle_damage)에 위임한다. 클라이언트가 최신 HP를
    // 미리 읽어와 계산한 절대값으로 덮어쓰던 예전 방식은 동시에 여러 명이 같은 보스에 적용할 때
    // 나중 쓰기가 먼저 쓰기를 덮어써 데미지가 유실되는 버그가 있었다 — RPC 내부에서 대상 행을
    // 잠그고 "현재 값에서 차감/누적"하므로 동시 호출이 자동으로 직렬화된다.
    try {
      const { data, error } = await supabase.rpc('apply_real_battle_damage', {
        p_mock_battle_id: mockBattle.id,
        p_real_damage: finalDamage,
        p_is_last_hit: isLastHit,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;

      switch (result?.code) {
        case 'applied':
          alert('실전 타수가 적용되었습니다!');
          onApplyComplete();
          return;
        case 'cap_reached':
          alert('해당 유저는 이번 시즌 3타를 모두 소진하였습니다.');
          onApplyComplete();
          return;
        case 'overkill_without_last_hit':
          alert('실제 체력을 초과한 대미지를 입력하였습니다.\n막타의 경우 하단의 체크 버튼을 이용해주세요.');
          return;
        case 'already_completed':
          alert('이미 적용된 기록입니다.');
          onApplyComplete();
          return;
        case 'boss_cleared':
          alert('이미 처치된 보스입니다.');
          onApplyComplete();
          return;
        default:
          alert('적용 실패: 알 수 없는 응답입니다.');
      }
    } catch (err) {
      console.error(err);
      alert('적용 실패: ' + err.message);
    }
  };

  if (!isOpen || !mockBattle) return null;

  const mockDmgText = formatHp(mockBattle.expected_damage, hpMode);

  return (
    <div 
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10002, padding: '20px' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--surface-3)', borderRadius: '8px', width: '500px', maxWidth: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '15px 20px', borderBottom: '1px solid var(--surface-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--surface-2)' }}>
          <h3 style={{ margin: 0, color: 'var(--accent-green)' }}>실제 딜로 적용</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>
        
        <form onSubmit={handleSubmit} style={{ padding: '20px' }}>
          {/* Nikke Icons */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginBottom: '20px' }}>
            {nikkes.map((n, i) => (
              <div key={i} style={{ width: '60px', height: '60px', backgroundColor: 'var(--surface-1)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-1)' }}>
                {n && n.image_url ? (
                  <img src={n.image_url} alt="nikke" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--border-3)', fontSize: '0.8rem' }}>비어있음</div>
                )}
              </div>
            ))}
          </div>
          
          {/* Grid for Dmg */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', color: 'var(--text-soft)', fontSize: '0.9rem' }}>모의전 기록</label>
              <div style={{ padding: '10px', backgroundColor: 'var(--surface-1)', borderRadius: '4px', border: '1px solid var(--border-1)', color: 'var(--text-strong)', textAlign: 'center', fontWeight: 'bold' }}>
                {mockDmgText}
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                <label style={{ color: 'var(--text-soft)', fontSize: '0.9rem' }}>실제 기록</label>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button type="button" onClick={() => setHpMode('simple')} style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border-2)', backgroundColor: hpMode === 'simple' ? 'var(--accent-blurple)' : 'var(--surface-2)', color: 'var(--text-strong)' }}>간이</button>
                  <button type="button" onClick={() => setHpMode('detail')} style={{ padding: '2px 8px', fontSize: '0.75rem', borderRadius: '4px', cursor: 'pointer', border: '1px solid var(--border-2)', backgroundColor: hpMode === 'detail' ? 'var(--accent-blurple)' : 'var(--surface-2)', color: 'var(--text-strong)' }}>상세</button>
                </div>
              </div>
              <input 
                type="text" 
                value={isLastHit ? (bossStatus.current_hp > 0 ? (hpMode === 'simple' ? (bossStatus.current_hp/100000000).toFixed(1) : bossStatus.current_hp.toLocaleString()) : '0') : actualDamage}
                onChange={e => {
                  let val = e.target.value;
                  if (hpMode === 'simple') {
                    val = val.replace(/[^0-9.]/g, '');
                    setActualDamage(val);
                  } else {
                    val = val.replace(/[^0-9]/g, '');
                    setActualDamage(val ? parseInt(val, 10).toLocaleString() : '');
                  }
                }}
                placeholder={hpMode === 'simple' ? "예: 3.2 (억 단위)" : "예: 320000000"}
                disabled={isLastHit}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px', backgroundColor: isLastHit ? 'var(--border-1)' : 'var(--surface-1)', border: '1px solid var(--accent-blurple)', borderRadius: '4px', color: 'var(--text-strong)', outline: 'none', textAlign: 'center', fontWeight: 'bold' }}
              />
            </div>
          </div>
          
          <div style={{ marginBottom: '25px', textAlign: 'center' }}>
            {isInfinite ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                무한(4단계) 보스는 막타가 없으며, 입력한 대미지가 누적됩니다.
              </div>
            ) : (
              <>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <input
                    type="checkbox"
                    checked={isLastHit}
                    onChange={e => setIsLastHit(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ color: 'var(--danger)', fontWeight: 'bold' }}>막타일 경우 체크해주세요.</span>
                </label>
                {isLastHit && (
                  <div style={{ marginTop: '5px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    실제 대미지는 자동으로 현재 남은 체력으로 기록되며, <br/>초과 딜량은 오버딜로 표시됩니다.
                  </div>
                )}
              </>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '12px', backgroundColor: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>취소</button>
            <button type="submit" style={{ flex: 1, padding: '12px', backgroundColor: 'var(--accent-green)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>적용</button>
          </div>
        </form>
      </div>
    </div>
  );
}
