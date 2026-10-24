import React, { useEffect, useMemo, useRef, useState } from 'react';
import { filterManualTargets } from '../../lib/manualTargets';

// 수기 입력 대상 닉네임을 "고르는" 콤보박스.
// 입력창을 누르면 길드 로스터 + 이미 적힌 수기 닉네임이 아래로 펼쳐지고, 타이핑하면 그
// 목록이 좁혀진다. 목록에 없는 사람(외부 용병 등)은 예전처럼 그냥 적으면 된다.
// 후보를 고르면 onPick으로 그 사람의 싱크로를 넘겨, 폼이 레벨 칸을 채우게 한다.
export default function ManualTargetPicker({
  value,
  onChange,
  onPick,
  targets = [],
  accent = 'var(--accent-amber)',
  placeholder = '닉네임 선택 또는 직접 입력...',
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const matches = useMemo(() => filterManualTargets(targets, value), [targets, value]);
  // 목록이 줄어들면 하이라이트가 없는 항목을 가리킬 수 있어, 쓸 때 범위로 자른다.
  const cursor = matches.length > 0 ? Math.min(activeIndex, matches.length - 1) : 0;

  // 바깥을 클릭하면 닫는다. (모달 안이라 blur 타이밍보다 이쪽이 안정적)
  useEffect(() => {
    if (!open) return;
    const handleDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    return () => document.removeEventListener('mousedown', handleDown);
  }, [open]);

  // 키보드로 옮긴 항목이 목록 밖으로 나가지 않게 따라 스크롤.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children?.[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor, open]);

  const pick = (t) => {
    onChange(t.name);
    onPick?.(t);
    setOpen(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      if (matches.length === 0) return;
      const next = cursor + (e.key === 'ArrowDown' ? 1 : -1);
      setActiveIndex((next + matches.length) % matches.length);
      return;
    }
    if (e.key === 'Enter' && open && matches[cursor]) {
      // 목록에서 고르는 중에는 폼이 제출되지 않게 막는다.
      e.preventDefault();
      pick(matches[cursor]);
      return;
    }
    if (e.key === 'Escape' && open) {
      // 목록만 닫는다 — 모달까지 닫히지 않도록 window 리스너로 올려보내지 않는다.
      e.stopPropagation();
      setOpen(false);
    }
  };

  // 지금 적힌 닉네임이 후보와 정확히 같은지(= 고른 사람인지) — 오타 확인용 힌트.
  const typed = (value || '').trim();
  const exact = typed ? targets.find((t) => t.name === typed) : null;

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setActiveIndex(0); setOpen(true); }}
        onFocus={() => { setActiveIndex(0); setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: `1px solid ${accent}`, background: 'var(--surface-0)', color: 'var(--text-strong)', boxSizing: 'border-box' }}
      />

      {typed && (
        <div style={{ marginTop: '4px', fontSize: '0.75rem', color: exact ? 'var(--text-muted)' : 'var(--text-dim)' }}>
          {exact
            ? `${exact.isMember ? '길드원' : '기존 수기 기록'}${exact.synchroLevel != null ? ` · Lv.${exact.synchroLevel}` : ''}`
            : '목록에 없는 새 닉네임으로 등록됩니다'}
        </div>
      )}

      {open && (
        <div
          style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', maxHeight: '220px', overflowY: 'auto', backgroundColor: 'var(--surface-2)', border: `1px solid ${accent}`, borderRadius: '4px', boxShadow: '0 6px 16px rgba(0,0,0,0.35)', zIndex: 30 }}
        >
          {matches.length === 0 ? (
            <div style={{ padding: '10px', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
              일치하는 닉네임이 없습니다. 그대로 입력하면 새 닉네임으로 등록됩니다.
            </div>
          ) : (
            <div ref={listRef} role="listbox">
              {matches.map((t, idx) => (
                <div
                  key={t.name}
                  role="option"
                  aria-selected={idx === cursor}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseDown={(e) => { e.preventDefault(); pick(t); }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 10px', cursor: 'pointer', backgroundColor: idx === cursor ? 'var(--surface-4)' : 'transparent' }}
                >
                  <span style={{ color: 'var(--text-strong)', fontSize: '0.85rem', minWidth: 0, wordBreak: 'break-all' }}>
                    {t.name}
                  </span>
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem' }}>
                    {!t.isMember && (
                      <span style={{ padding: '1px 5px', borderRadius: '3px', border: '1px solid var(--border-3)', color: 'var(--text-dim)' }}>외부</span>
                    )}
                    <span style={{ color: 'var(--text-muted)' }}>
                      {t.synchroLevel != null ? `Lv.${t.synchroLevel}` : '레벨 없음'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
