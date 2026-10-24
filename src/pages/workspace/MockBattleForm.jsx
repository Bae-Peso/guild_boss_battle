import React, { useState, useEffect, useMemo, useRef } from 'react';
import NikkeSelectorModal from './NikkeSelectorModal';
import ManualTargetPicker from './ManualTargetPicker';


export default function MockBattleForm({ onSubmit, isAdmin, onCancel, submitLabel = "저장", initialSynchroLevel = 1, initialData = null, title = "+ 새 모의전 등록", hideAdminOptions = false, usedNikkeIds = [], usedNikkesByIdentity = null, computeIdentityKey = null, currentUserId = null, isLocked = false, checkPrevSynchro = null, bossName = null, bossElement = null, manualTargets = [] }) {
  const [damageInput, setDamageInput] = useState(initialData?.expected_damage ? String(initialData.expected_damage) : '');
  const [damageMode, setDamageMode] = useState('simple');
  const [synchroLevel, setSynchroLevel] = useState(initialData?.synchro_level || initialSynchroLevel);
  const [selectedNikkes, setSelectedNikkes] = useState(initialData?.nikkes || [null, null, null, null, null]);
  const [memo, setMemo] = useState(initialData?.memo || '');
  const [isNikkeModalOpen, setIsNikkeModalOpen] = useState(false);
  const [selectingSlotIndex, setSelectingSlotIndex] = useState(0);
  
  const [isManualTarget, setIsManualTarget] = useState(initialData?.is_admin_written || false);
  const [manualNickname, setManualNickname] = useState(initialData?.manual_nickname || '');
  // 목록에서 고른 대상의 싱크로를 채웠을 때 그 사람 이름. (칸 아래 "불러옴" 안내용)
  // 직접 고쳐 적으면 null로 되돌려, 안내가 실제 값과 어긋나지 않게 한다.
  const [synchroFilledFrom, setSynchroFilledFrom] = useState(null);
  // 수기 입력을 켜면서 남의 레벨을 불러왔다가 다시 끄면, 그 값이 내 기록으로 저장되고
  // 내 프로필 싱크로까지 덮어쓰게 된다. 켜기 직전의 내 레벨을 들고 있다가 되돌린다.
  const ownSynchroRef = useRef(initialData?.synchro_level || initialSynchroLevel);

  // 지난 시즌과 싱크로가 같을 때 띄우는 경고. { payload, level, seasonName } 이면 모달 표시.
  const [synchroWarn, setSynchroWarn] = useState(null);
  const [checkingSynchro, setCheckingSynchro] = useState(false);
  const synchroInputRef = useRef(null);

  useEffect(() => {
    if (initialData) {
      if (initialData.expected_damage) {
        if (damageMode === 'simple') {
          setDamageInput((initialData.expected_damage / 100000000).toFixed(1));
        } else {
          setDamageInput(Number(initialData.expected_damage).toLocaleString());
        }
      } else {
        setDamageInput('');
      }
      setSynchroLevel(initialData.synchro_level || initialSynchroLevel);
      setSelectedNikkes(initialData.nikkes || [null, null, null, null, null]);
      setMemo(initialData.memo || '');
      setIsManualTarget(initialData.is_admin_written || false);
      setManualNickname(initialData.manual_nickname || '');
      setSynchroFilledFrom(null);
      ownSynchroRef.current = initialData.synchro_level || initialSynchroLevel;
    }
  }, [initialData, initialSynchroLevel]);

  // 지금 작성 중인 대상(수기 닉네임/싱크로 또는 로그인 유저)의 "이미 사용된 니케"를 계산한다.
  // 부모가 넘긴 computeIdentityKey로 식별 키를 만들어, 닉네임+싱크로가 같은 기록이 하나로 묶이게 한다.
  // 이렇게 하면 로그인 유저 본인이 쓴 니케가 대리 작성 화면에서 잘못 "사용됨"으로 표시되지 않는다.
  // usedNikkesByIdentity/컴퓨트 키가 없으면(수정 모달 등) 부모가 넘긴 usedNikkeIds를 그대로 쓴다.
  const effectiveUsedNikkeIds = useMemo(() => {
    if (!usedNikkesByIdentity || !computeIdentityKey) return usedNikkeIds;
    const trimmed = manualNickname.trim();
    if (isManualTarget && !trimmed) return []; // 수기인데 닉네임 미입력 → 계산 불가
    const activeKey = computeIdentityKey({ isManualTarget, manualNickname: trimmed, synchroLevel, currentUserId });
    if (!activeKey) return [];
    return Array.from(usedNikkesByIdentity[activeKey] || []);
  }, [usedNikkesByIdentity, computeIdentityKey, usedNikkeIds, isManualTarget, manualNickname, synchroLevel, currentUserId]);

  // 목록에서 대상을 고르면 그 사람의 싱크로를 채운다. 값은 그대로 수정할 수 있다.
  const handlePickManualTarget = (target) => {
    if (target?.synchroLevel != null) {
      setSynchroLevel(Number(target.synchroLevel));
      setSynchroFilledFrom(target.name);
    } else {
      setSynchroFilledFrom(null);
    }
  };

  // 수기 입력을 켤 때 내 레벨을 보관하고, 끌 때 되돌린다(남의 레벨이 내 기록에 남지 않게).
  const handleToggleManualTarget = (checked) => {
    setIsManualTarget(checked);
    if (checked) {
      ownSynchroRef.current = synchroLevel;
    } else {
      setSynchroLevel(ownSynchroRef.current);
      setSynchroFilledFrom(null);
    }
  };

  const openNikkeSelector = (idx) => {
    setSelectingSlotIndex(idx);
    setIsNikkeModalOpen(true);
  };

  const handleNikkeConfirm = (newNikkes) => {
    setSelectedNikkes(newNikkes);
    setIsNikkeModalOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!damageInput) {
      alert("모의전 대미지를 입력해주세요.");
      return;
    }
    
    // Parse damage strictly taking only numbers and dots
    const sanitizedInput = damageInput.replace(/[^0-9.]/g, '');
    if (!sanitizedInput) {
      alert("유효한 딜량을 숫자로 입력해주세요.");
      return;
    }
    
    let damage = parseFloat(sanitizedInput);
    if (damageMode === 'simple') {
      damage = Math.round(damage * 100000000);
    } else {
      damage = parseInt(sanitizedInput, 10);
    }
    
    if (isManualTarget && !manualNickname.trim()) {
      alert("대리 작성 대상 유저의 닉네임을 입력해주세요.");
      return;
    }
    
    const payload = {
      damage,
      synchroLevel,
      nikkes: selectedNikkes,
      memo: memo.trim() || null,
      isManualTarget,
      manualNickname: isManualTarget ? manualNickname.trim() : null
    };

    // 지난 시즌과 싱크로가 그대로면 한 번 확인받는다(레벨 갱신 잊고 등록하는 것을 막기 위함).
    if (checkPrevSynchro) {
      setCheckingSynchro(true);
      let prev = null;
      try {
        prev = await checkPrevSynchro({ isManualTarget, manualNickname: payload.manualNickname, synchroLevel });
      } finally {
        setCheckingSynchro(false);
      }
      if (prev && Number(prev.level) === Number(synchroLevel)) {
        setSynchroWarn({ payload, level: Number(prev.level), seasonName: prev.seasonName });
        return;
      }
    }

    onSubmit(payload);
  };

  return (
    <div style={{ backgroundColor: 'var(--surface-1)', padding: '15px', borderRadius: '8px', border: '1px solid var(--border-1)' }}>
      {title && <h4 style={{ marginTop: 0, marginBottom: '15px', color: 'var(--text-strong)' }}>{title}</h4>}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        
        {isAdmin && !hideAdminOptions && (
          <div style={{ padding: '10px', backgroundColor: 'rgba(255, 193, 7, 0.1)', border: '1px solid var(--accent-amber)', borderRadius: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--accent-amber)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isManualTarget} onChange={(e) => handleToggleManualTarget(e.target.checked)} />
              기록 수기 입력 (미가입자, 미사용자 기록 수기 입력)
            </label>
            {isManualTarget && (
              <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>대상 유저</label>
                  <ManualTargetPicker
                    value={manualNickname}
                    onChange={(name) => { setManualNickname(name); setSynchroFilledFrom(null); }}
                    onPick={handlePickManualTarget}
                    targets={manualTargets}
                  />
                </div>
                <div style={{ width: '110px', flexShrink: 0 }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>싱크로 레벨</label>
                  <input 
                    type="number" 
                    value={synchroLevel}
                    onChange={(e) => { setSynchroLevel(parseInt(e.target.value, 10) || 1); setSynchroFilledFrom(null); }}
                    placeholder="싱크로 레벨"
                    min="1"
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--accent-amber)', background: 'var(--surface-0)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
                  />
                  <div style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                    {synchroFilledFrom ? '불러옴 · 수정 가능' : '직접 입력'}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '15px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
              <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>모의전 대미지</label>
              <button 
                type="button"
                onClick={() => setDamageMode(prev => prev === 'simple' ? 'detail' : 'simple')}
                style={{ fontSize: '0.8rem', padding: '4px 8px', background: damageMode === 'simple' ? '#3b82f6' : '#ef4444', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                {damageMode === 'simple' ? '간이 모드' : '상세 모드'}
              </button>
            </div>
            <input 
              type="text" 
              value={damageInput}
              onChange={(e) => {
                if (damageMode === 'simple') {
                  setDamageInput(e.target.value);
                } else {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  setDamageInput(val ? parseInt(val, 10).toLocaleString() : '');
                }
              }}
              placeholder={damageMode === 'simple' ? "예: 1.5 (1억 5천만)" : "예: 150000000"}
              style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-0)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ width: '100px' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>싱크로 레벨</label>
            <input
              type="number"
              ref={synchroInputRef}
              value={synchroLevel}
              onChange={(e) => { setSynchroLevel(parseInt(e.target.value) || 1); setSynchroFilledFrom(null); }}
              min="1"
              style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-0)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
            />
            {synchroFilledFrom && (
              <div style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-dim)', wordBreak: 'break-all' }}>
                {synchroFilledFrom} 값 불러옴
              </div>
            )}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>사용 스쿼드 (클릭하여 5기 편성)</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            {[0, 1, 2, 3, 4].map(idx => (
              <div 
                key={idx} 
                onClick={() => openNikkeSelector(idx)}
                style={{ flex: 1, aspectRatio: '1/1', backgroundColor: 'var(--surface-2)', border: '1px dashed var(--border-3)', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-dim)', fontSize: '0.85rem', overflow: 'hidden' }}
              >
                {selectedNikkes[idx] ? (
                  selectedNikkes[idx].image_url ? 
                    <img src={selectedNikkes[idx].image_url} alt="nikke" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> :
                    selectedNikkes[idx].name.substring(0, 3)
                ) : '+'}
              </div>
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>메모 (선택사항)</label>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예: 풀버스트 타이밍, 스킬 순서 등 (기록 표에 📝로 표시됩니다)"
            rows={2}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border-1)', background: 'var(--surface-0)', color: 'var(--text-strong)', boxSizing: 'border-box', resize: 'vertical' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="submit" disabled={isLocked || checkingSynchro} style={{ flex: 1, padding: '12px', background: (isLocked || checkingSynchro) ? 'var(--border-3)' : 'var(--accent-green)', color: (isLocked || checkingSynchro) ? 'var(--text-soft)' : 'var(--text-inverse)', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: (isLocked || checkingSynchro) ? 'not-allowed' : 'pointer' }}>
            {isLocked ? '시즌 잠김' : (checkingSynchro ? '확인 중...' : submitLabel)}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} style={{ padding: '12px', background: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
              취소
            </button>
          )}
        </div>
      </form>
      
      <NikkeSelectorModal
        isOpen={isNikkeModalOpen}
        onClose={() => setIsNikkeModalOpen(false)}
        initialSelected={selectedNikkes}
        activeSlotIndex={selectingSlotIndex}
        onConfirm={handleNikkeConfirm}
        usedNikkeIds={effectiveUsedNikkeIds}
        bossName={bossName}
        bossElement={bossElement}
      />

      {/* 싱크로가 지난 시즌과 같을 때의 확인 모달 */}
      {synchroWarn && (
        <div
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}
          onClick={(e) => { if (e.target === e.currentTarget) setSynchroWarn(null); }}
        >
          <div style={{ backgroundColor: 'var(--surface-2)', border: '1px solid var(--accent-amber)', borderRadius: '8px', padding: '20px', width: '420px', maxWidth: '100%' }}>
            <h4 style={{ margin: '0 0 12px', color: 'var(--accent-amber)' }}>⚠️ 싱크로 레벨이 그대로예요</h4>
            <p style={{ margin: '0 0 8px', color: 'var(--text-strong)', lineHeight: 1.5 }}>
              입력한 싱크로 레벨 <strong>Lv.{synchroWarn.level}</strong> 이(가)
              지난 시즌{synchroWarn.seasonName ? ` (${synchroWarn.seasonName})` : ''}과 동일합니다.
            </p>
            <p style={{ margin: '0 0 18px', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
              레벨을 올렸는데 갱신하지 않은 건 아닌지 확인해 주세요. 이 값은 결산의 성장 계산에 그대로 쓰입니다.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button"
                onClick={() => {
                  setSynchroWarn(null);
                  setTimeout(() => { synchroInputRef.current?.focus(); synchroInputRef.current?.select(); }, 0);
                }}
                style={{ flex: 1, padding: '10px', background: 'var(--accent-amber)', color: '#000', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
                레벨 수정하기
              </button>
              <button type="button"
                onClick={() => { const p = synchroWarn.payload; setSynchroWarn(null); onSubmit(p); }}
                style={{ flex: 1, padding: '10px', background: 'transparent', color: 'var(--text-soft)', border: '1px solid var(--border-3)', borderRadius: '4px', cursor: 'pointer' }}>
                그대로 등록
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
