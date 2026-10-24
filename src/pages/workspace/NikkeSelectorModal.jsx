import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import NikkeAvatar from '../../components/NikkeAvatar';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import { BURST_BIT, burstMaskToLabel } from '../../utils/burst';
import { fetchNikkeUsage } from '../../lib/nikkeUsage';
import { useDemo } from '../../demo/DemoContext';
import { useIsMobile, useMediaQuery } from '../../hooks/useMediaQuery';

// 사용 빈도 집계 범위를 헤더에 짧게 알려준다. 목록 순서가 왜 바뀌는지 설명이 없으면
// "가나다순이 깨졌다"로 읽히기 때문.
const USAGE_SCOPE_LABEL = {
  boss: '이 보스 사용률순',
  element: '같은 속성 사용률순',
  all: '최근 시즌 사용률순',
};

function NikkeSelectorModal({ isOpen, onClose, initialSelected = [null, null, null, null, null], activeSlotIndex = 0, onConfirm, usedNikkeIds = [], bossName = null, bossElement = null }) {
  useEscapeKey(isOpen, onClose);
  const demo = useDemo();
  // 좁거나(모바일) 낮은(가로 모드) 화면에서는 헤더+슬롯+필터+푸터의 고정 높이만으로 모달을 다 먹어
  // 니케 그리드가 40px까지 눌린다. compact일 때는 여백/슬롯/카드를 줄이고 필터를 접는다.
  const isNarrowVp = useIsMobile(820);
  const isShortVp = useMediaQuery('(max-height: 560px)');
  const compact = isNarrowVp || isShortVp;
  const slotSize = compact ? 56 : 80;
  const cardSize = compact ? 72 : 90;
  const blockPad = compact ? '10px 14px' : '15px 20px';
  const [nikkes, setNikkes] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [loading, setLoading] = useState(true);
  // 최근 시즌 사용 빈도 점수. Map<nikkeId, score>
  const [usage, setUsage] = useState({ scores: new Map(), scope: null });

  const [searchQuery, setSearchQuery] = useState('');
  const [burstFilter, setBurstFilter] = useState(0); // bitmask; 0 = no filter
  const [classFilter, setClassFilter] = useState('ALL');
  const [manufacturerFilter, setManufacturerFilter] = useState('ALL');
  const [weaponFilter, setWeaponFilter] = useState('ALL');
  const [elementFilter, setElementFilter] = useState('ALL');
  const [favoriteFilter, setFavoriteFilter] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Multi-selector state
  const [selectedSlots, setSelectedSlots] = useState([...initialSelected]);
  const [focusedSlot, setFocusedSlot] = useState(0);

  // 터치에는 우클릭이 없다(iOS Safari는 롱프레스로 contextmenu를 띄워주지 않는다).
  // 카드 위 별 버튼은 아바타 모서리 아이콘을 가리고 오터치도 늘어서, 길게 누르기로 대신한다.
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);
  const firedResetTimer = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    
    // Reset state when opened
    const currentSelected = [...initialSelected];
    setSelectedSlots(currentSelected);
    
    // Always find first empty slot to start
    const firstEmpty = currentSelected.findIndex(s => s === null);
    setFocusedSlot(firstEmpty !== -1 ? firstEmpty : 0);
    
    const fetchNikkes = async () => {
      setLoading(true);
      try {
        const { data: nikkeData, error } = await supabase.from('nikkes').select('*').order('name');
        if (error) throw error;
        setNikkes(nikkeData || []);
        
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: favData } = await supabase.from('user_favorite_nikkes').select('nikke_id').eq('user_id', user.id);
          if (favData) setFavorites(favData.map(f => f.nikke_id));
        }
      } catch (err) {
        console.error('Failed to fetch Nikkes:', err);
      } finally {
        setLoading(false);
      }
    };
    
    fetchNikkes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 사용 빈도는 니케 목록과 별개로 받는다. 이쪽이 늦거나 실패해도 목록은 바로 뜨고,
  // 점수가 도착하면 정렬만 다시 걸린다.
  useEffect(() => {
    if (!isOpen) return;
    if (demo.isDemo) { setUsage({ scores: new Map(), scope: null }); return; }

    let active = true;
    fetchNikkeUsage({ bossName, element: bossElement }).then(result => {
      if (active) setUsage(result);
    });
    return () => { active = false; };
  }, [isOpen, bossName, bossElement, demo.isDemo]);

  // compact에서는 접힌 상태로 열어 니케 그리드를 먼저 보여준다. 넓은 화면은 기존대로 펼침.
  useEffect(() => {
    if (isOpen) setFiltersOpen(!compact);
  }, [isOpen, compact]);

  // 누른 채로 모달이 닫히면 타이머만 남아 나중에 즐겨찾기가 토글된다.
  useEffect(() => () => {
    clearTimeout(longPressTimer.current);
    clearTimeout(firedResetTimer.current);
  }, []);

  if (!isOpen) return null;

  const resetFilters = () => {
    setSearchQuery('');
    setBurstFilter(0);
    setClassFilter('ALL');
    setManufacturerFilter('ALL');
    setWeaponFilter('ALL');
    setElementFilter('ALL');
    setFavoriteFilter(false);
  };

  const toggleFavorite = async (n) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('로그인이 필요합니다.');
    
    const isFav = favorites.includes(n.id);
    if (isFav) {
      setFavorites(favorites.filter(id => id !== n.id));
      await supabase.from('user_favorite_nikkes').delete().match({ user_id: user.id, nikke_id: n.id });
    } else {
      setFavorites([...favorites, n.id]);
      await supabase.from('user_favorite_nikkes').insert({ user_id: user.id, nikke_id: n.id });
    }
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // 터치가 끝나면 억제 플래그를 되돌린다. 롱프레스 뒤에 click이 따라오는 기기도 있고
  // (안드로이드처럼) contextmenu만 쏘고 마는 기기도 있어서, click에만 맡기면 플래그가 남아
  // 다음 마우스 클릭 한 번을 통째로 삼킨다. click 지연(~300ms)보다 넉넉하게 잡는다.
  const endTouchGesture = () => {
    cancelLongPress();
    clearTimeout(firedResetTimer.current);
    firedResetTimer.current = setTimeout(() => { longPressFired.current = false; }, 400);
  };

  const startLongPress = (n) => {
    cancelLongPress();
    clearTimeout(firedResetTimer.current);
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      longPressTimer.current = null;
      navigator.vibrate?.(30);
      toggleFavorite(n);
    }, 500);
  };

  // 안드로이드 크롬은 롱프레스에 contextmenu까지 쏜다. 타이머와 양쪽에서 토글하면
  // 두 번 뒤집혀 아무 일도 안 한 것처럼 보이므로, 한 제스처당 한 번만 처리한다.
  const handleContextMenu = (e, n) => {
    e.preventDefault();
    const fromTouch = longPressTimer.current !== null || longPressFired.current;
    if (!fromTouch) {
      toggleFavorite(n); // 데스크톱 우클릭
      return;
    }
    cancelLongPress();
    if (longPressFired.current) return; // 타이머가 이미 처리함
    longPressFired.current = true;
    toggleFavorite(n);
  };

  const handleCardClick = (n) => {
    // 롱프레스로 즐겨찾기를 토글한 직후 따라오는 click은 선택으로 처리하지 않는다.
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    handleNikkeSelect(n);
  };

  const handleNikkeSelect = (n) => {
    const existingIdx = selectedSlots.findIndex(s => s && s.id === n.id);
    if (existingIdx !== -1) {
      // If already selected, remove it
      const newSlots = [...selectedSlots];
      newSlots[existingIdx] = null;
      setSelectedSlots(newSlots);
      setFocusedSlot(existingIdx); // Auto focus the newly emptied slot
      return;
    }

    let targetSlot = focusedSlot;
    if (targetSlot === null) {
      // Find first empty
      targetSlot = selectedSlots.findIndex(s => s === null);
      if (targetSlot === -1) targetSlot = 4;
    }
    
    const newSlots = [...selectedSlots];
    newSlots[targetSlot] = n;
    setSelectedSlots(newSlots);
    
    // Auto advance to next empty slot
    const nextEmpty = newSlots.findIndex((s, i) => i > targetSlot && s === null);
    if (nextEmpty !== -1) {
      setFocusedSlot(nextEmpty);
    } else {
      const anyEmpty = newSlots.findIndex(s => s === null);
      setFocusedSlot(anyEmpty !== -1 ? anyEmpty : null);
    }
  };

  const handleSlotClick = (idx) => {
    setFocusedSlot(idx);
  };

  const handleClearSlot = (idx) => {
    const newSlots = [...selectedSlots];
    newSlots[idx] = null;
    setSelectedSlots(newSlots);
    setFocusedSlot(idx);
  };

  const filteredNikkes = nikkes.filter(n => {
    if (favoriteFilter && !favorites.includes(n.id)) return false;
    
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = n.name.toLowerCase().includes(q);
      const matchAlias = n.aliases && n.aliases.toLowerCase().includes(q);
      if (!matchName && !matchAlias) return false;
    }
    
    if (burstFilter !== 0 && (n.burst_type & burstFilter) === 0) return false;
    if (classFilter !== 'ALL' && n.class !== classFilter) return false;
    if (manufacturerFilter !== 'ALL' && n.manufacturer !== manufacturerFilter) return false;
    if (weaponFilter !== 'ALL' && n.weapon !== weaponFilter) return false;
    if (elementFilter !== 'ALL' && n.element !== elementFilter) return false;
    return true;
  });

  filteredNikkes.sort((a, b) => {
    const aUsed = usedNikkeIds.includes(a.id);
    const bUsed = usedNikkeIds.includes(b.id);
    
    const aSelected = selectedSlots.some(s => s && s.id === a.id);
    const bSelected = selectedSlots.some(s => s && s.id === b.id);
    
    // 1. Selected items first
    if (aSelected && !bSelected) return -1;
    if (!aSelected && bSelected) return 1;

    // 2. Used items last
    if (aUsed && !bUsed) return 1;
    if (!aUsed && bUsed) return -1;

    // 3. Favorites next
    const aFav = favorites.includes(a.id);
    const bFav = favorites.includes(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;

    // 4. 최근 시즌 사용 빈도 점수 (높을수록 위)
    //    쓰인 적 없는 니케는 전부 0으로 동점이라 아래 이름순으로 떨어진다.
    const aScore = usage.scores.get(a.id) || 0;
    const bScore = usage.scores.get(b.id) || 0;
    if (aScore !== bScore) return bScore - aScore;

    return a.name.localeCompare(b.name);
  });

  const toggleBurstFilterBit = (bit) => {
    setBurstFilter(prev => prev ^ bit);
  };

  // 접었을 때 "필터가 걸려 있는데 안 보이는" 상태가 되지 않도록, 적용 중인 조건을 요약해 둔다.
  // 검색어는 입력창에 그대로 보이므로 제외.
  const activeFilterSummary = [];
  if (favoriteFilter) activeFilterSummary.push('★ 즐겨찾기');
  if (burstFilter !== 0) activeFilterSummary.push(`버스트 ${[1, 2, 3].filter(s => (burstFilter & BURST_BIT[s]) !== 0).join('·')}`);
  if (classFilter !== 'ALL') activeFilterSummary.push(classFilter);
  if (manufacturerFilter !== 'ALL') activeFilterSummary.push(manufacturerFilter);
  if (weaponFilter !== 'ALL') activeFilterSummary.push(weaponFilter);
  if (elementFilter !== 'ALL') activeFilterSummary.push(elementFilter);
  const activeFilterCount = activeFilterSummary.length;
  // 접혀 있어서 적용 조건이 화면에 안 보이는 상태. 토글 강조와 요약 칩의 공통 조건.
  const hiddenFilterAlert = !filtersOpen && activeFilterCount > 0;

  const renderBurstFilterButtons = () => (
    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
      <button
        onClick={() => setBurstFilter(0)}
        style={{
          padding: '5px 10px',
          backgroundColor: burstFilter === 0 ? 'var(--accent-green)' : 'var(--surface-2)',
          color: burstFilter === 0 ? 'var(--text-inverse)' : 'var(--text-strong)',
          border: '1px solid var(--border-1)',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '0.8rem'
        }}
      >
        ALL
      </button>
      {[1, 2, 3].map(stage => {
        const bit = BURST_BIT[stage];
        const active = (burstFilter & bit) !== 0;
        return (
          <button
            key={stage}
            onClick={() => toggleBurstFilterBit(bit)}
            style={{
              padding: '5px 10px',
              backgroundColor: active ? 'var(--accent-green)' : 'var(--surface-2)',
              color: active ? 'var(--text-inverse)' : 'var(--text-strong)',
              border: '1px solid var(--border-1)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            {stage}
          </button>
        );
      })}
    </div>
  );

  const renderFilterButtons = (options, currentFilter, setFilter) => (
    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => setFilter(opt)}
          style={{
            padding: '5px 10px',
            backgroundColor: currentFilter === opt ? 'var(--accent-green)' : 'var(--surface-2)',
            color: currentFilter === opt ? 'var(--text-inverse)' : 'var(--text-strong)',
            border: '1px solid var(--border-1)',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.8rem'
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );

  return (
    <>
    <style>{`
      .nikke-name-container {
        overflow: hidden;
        white-space: nowrap;
        width: 100%;
      }
      .nikke-name-static {
        display: block;
        text-align: center;
      }
      .nikke-name-marquee {
        display: inline-block;
        padding-left: 100%;
        animation: marquee 6s linear infinite;
      }
      @keyframes marquee {
        from { transform: translateX(0); }
        to { transform: translateX(-100%); }
      }
    `}</style>
    <div 
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--surface-1)', width: compact ? '96%' : '90%', maxWidth: '800px', height: compact ? '95%' : '85%', borderRadius: '8px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: blockPad, borderBottom: '1px solid var(--border-1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <h3 style={{ margin: 0, color: 'var(--text-strong)', fontSize: compact ? '1rem' : undefined }}>니케 편성 <span style={{ fontSize: compact ? '0.7rem' : '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: compact ? '6px' : '10px' }}>
            {compact
              ? `길게 눌러 즐겨찾기${usage.scope ? ` · ★ 다음은 ${USAGE_SCOPE_LABEL[usage.scope] || '사용률순'}` : ''}`
              : `(우클릭으로 즐겨찾기 등록/해제${usage.scope ? ` · ★ 다음은 ${USAGE_SCOPE_LABEL[usage.scope] || '사용률순'}` : ''})`}
          </span></h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-strong)', fontSize: '1.5rem', cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>&times;</button>
        </div>

        {/* Squad Builder Slots */}
        <div style={{ padding: blockPad, backgroundColor: '#18191c', display: 'flex', gap: compact ? '6px' : '10px', justifyContent: 'center' }}>
          {[0, 1, 2, 3, 4].map(idx => {
            const n = selectedSlots[idx];
            const isFocused = focusedSlot === idx;
            return (
              <div
                key={idx}
                onClick={() => handleSlotClick(idx)}
                onDoubleClick={() => handleClearSlot(idx)}
                style={{
                  // compact에서는 폭만 눌려 정사각형이 깨지므로 aspect-ratio로 비율을 지킨다.
                  ...(compact
                    ? { flex: '1 1 0', maxWidth: `${slotSize}px`, aspectRatio: '1 / 1' }
                    : { width: `${slotSize}px`, height: `${slotSize}px` }),
                  backgroundColor: 'var(--surface-2)',
                  border: isFocused ? '2px solid var(--accent-green)' : '2px dashed var(--border-3)',
                  borderRadius: '8px', 
                  display: 'flex', 
                  flexDirection: 'column',
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  cursor: 'pointer', 
                  position: 'relative',
                  overflow: 'hidden',
                  opacity: (focusedSlot !== null && !isFocused) ? 0.7 : 1
                }}
                title={n ? "더블클릭하여 제거" : "클릭하여 선택"}
              >
                {n ? (
                  <>
                    {n.image_url ? (
                      <img src={n.image_url} alt={n.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: '1rem', color: 'var(--text-strong)' }}>{n.name.substring(0, 3)}</span>
                    )}
                    <div style={{ position: 'absolute', bottom: 0, width: '100%', background: 'rgba(0,0,0,0.8)', fontSize: '0.65rem', textAlign: 'center', padding: '2px 0' }}>
                      B{burstMaskToLabel(n.burst_type)}
                    </div>
                  </>
                ) : (
                  <span style={{ fontSize: '1.5rem', color: isFocused ? 'var(--accent-green)' : 'var(--border-3)' }}>+</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Filters */}
        <div style={{ padding: blockPad, backgroundColor: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: compact ? '8px' : '10px' }}>
          <div style={{ display: 'flex', gap: compact ? '6px' : '10px' }}>
            <input
              type="text"
              placeholder={compact ? '이름/축약어 검색' : '니케 이름 또는 축약어 검색'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ flex: 1, minWidth: 0, padding: compact ? '8px 10px' : '10px', borderRadius: '4px', border: '1px solid var(--border-1)', backgroundColor: 'var(--surface-0)', color: 'var(--text-strong)' }}
            />
            {/* 접기는 PC에서도 쓴다(기본 펼침). 조건이 숨겨질 때만 강조해서
                초기화 버튼과 파란 버튼이 나란히 두 개 서지 않게 한다. */}
            <button
              type="button"
              onClick={() => setFiltersOpen(o => !o)}
              aria-expanded={filtersOpen}
              style={{ flexShrink: 0, padding: compact ? '0 12px' : '0 15px', backgroundColor: hiddenFilterAlert ? '#4f46e5' : 'var(--surface-0)', color: 'var(--text-strong)', border: '1px solid var(--border-1)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: compact ? '0.85rem' : undefined, whiteSpace: 'nowrap' }}
            >
              필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''} {filtersOpen ? '▲' : '▼'}
            </button>
            {!compact && (
              <button
                onClick={resetFilters}
                style={{ padding: '0 15px', backgroundColor: '#4f46e5', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                필터 초기화
              </button>
            )}
          </div>

          {/* 접힌 상태에서도 무엇이 걸려 있는지 보이도록 요약 칩을 노출한다. */}
          {hiddenFilterAlert && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
              {activeFilterSummary.map(label => (
                <span key={label} style={{ fontSize: '0.7rem', color: 'var(--text-strong)', background: 'var(--surface-0)', border: '1px solid var(--border-1)', borderRadius: '10px', padding: '2px 8px' }}>
                  {label}
                </span>
              ))}
              {/* PC는 같은 줄에 초기화 버튼이 이미 있어서 링크를 겹쳐 두지 않는다. */}
              {compact && (
                <button
                  type="button"
                  onClick={resetFilters}
                  style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: '2px 4px' }}
                >
                  초기화
                </button>
              )}
            </div>
          )}

          {/* compact에서 펼쳐도 그리드를 다 먹지 않도록 패널 자체를 스크롤시킨다. */}
          <div style={{ display: filtersOpen ? 'flex' : 'none', gap: compact ? '10px' : '15px', flexWrap: 'wrap', maxHeight: compact ? '40vh' : undefined, overflowY: compact ? 'auto' : undefined }}>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>기타</span>
              <button
                onClick={() => setFavoriteFilter(!favoriteFilter)}
                style={{
                  padding: '5px 10px',
                  backgroundColor: favoriteFilter ? '#eab308' : 'var(--surface-2)',
                  color: favoriteFilter ? 'var(--text-inverse)' : 'var(--text-strong)',
                  border: '1px solid var(--border-1)',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '0.8rem'
                }}
              >
                ★ 즐겨찾기
              </button>
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>버스트</span>
              {renderBurstFilterButtons()}
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>클래스</span>
              {renderFilterButtons(['ALL', '화력형', '방어형', '지원형'], classFilter, setClassFilter)}
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>기업</span>
              {renderFilterButtons(['ALL', '엘리시온', '미실리스', '테트라', '필그림', '어브노멀'], manufacturerFilter, setManufacturerFilter)}
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>무기</span>
              {renderFilterButtons(['ALL', 'SR', 'AR', 'SG', 'SMG', 'MG', 'RL'], weaponFilter, setWeaponFilter)}
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>속성</span>
              {renderFilterButtons(['ALL', '작열', '수냉', '전격', '풍압', '철갑'], elementFilter, setElementFilter)}
            </div>
            {compact && (
              <div style={{ flexBasis: '100%', display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  onClick={resetFilters}
                  style={{ flex: 1, padding: '8px', backgroundColor: '#4f46e5', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                >
                  필터 초기화
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  style={{ flex: 1, padding: '8px', backgroundColor: 'var(--surface-0)', color: 'var(--text-strong)', border: '1px solid var(--border-1)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
                >
                  접기 ▲
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Grid */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: compact ? '12px 14px' : '20px' }}>
          {loading ? (
            <div style={{ color: 'var(--text-dim)', textAlign: 'center' }}>로딩 중...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`, gap: compact ? '8px' : '10px' }}>
              {filteredNikkes.map(n => {
                const isFav = favorites.includes(n.id);
                const isSelected = selectedSlots.some(s => s && s.id === n.id);
                const isUsed = usedNikkeIds.includes(n.id);
                
                return (
                  <div
                    key={n.id}
                    onClick={() => handleCardClick(n)}
                    onContextMenu={(e) => handleContextMenu(e, n)}
                    onTouchStart={() => startLongPress(n)}
                    onTouchMove={cancelLongPress}
                    onTouchEnd={endTouchGesture}
                    onTouchCancel={endTouchGesture}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      cursor: 'pointer',
                      opacity: isSelected ? 0.4 : (isUsed ? 0.3 : 1),
                      position: 'relative',
                      // 롱프레스 중 iOS의 이미지/텍스트 콜아웃이 뜨지 않게 한다.
                      WebkitTouchCallout: 'none',
                      WebkitUserSelect: 'none',
                      userSelect: 'none'
                    }}
                  >
                    {/* ★/✓ 배지를 아바타 모서리에 붙이려고 폭을 카드 크기로 고정(칸이 늘어나도 중앙 정렬 유지) */}
                    <div style={{ position: 'relative', width: `${cardSize}px`, maxWidth: '100%', display: 'flex', justifyContent: 'center' }}>
                      <NikkeAvatar nikkeId={n.id} size={cardSize} />
                      {isFav && !isSelected && (
                        <div style={{ position: 'absolute', top: '2px', right: '2px', color: '#eab308', zIndex: 10, fontSize: '1rem', textShadow: '0 0 4px var(--text-inverse)' }}>
                          ★
                        </div>
                      )}
                      {isSelected && (
                        <div style={{ position: 'absolute', top: '2px', right: '2px', color: 'var(--accent-green)', zIndex: 10, fontSize: '1.2rem', textShadow: '0 0 4px var(--text-inverse)' }}>
                          ✓
                        </div>
                      )}
                      {isUsed && !isSelected && (
                         <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'rgba(0,0,0,0.8)', color: 'var(--danger)', padding: '2px 5px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', zIndex: 10, whiteSpace: 'nowrap' }}>
                           *사용됨*
                         </div>
                      )}
                    </div>
                    <div style={{
                      marginTop: '5px',
                      width: '100%',
                      maxWidth: `${cardSize}px`,
                      backgroundColor: 'var(--surface-2)', 
                      padding: '4px 0', 
                      borderRadius: '4px',
                      border: isSelected ? '1px solid var(--accent-green)' : '1px solid var(--border-1)'
                    }}>
                      <div className="nikke-name-container" title={n.name}>
                        <span className={n.name.length > 5 ? "nikke-name-marquee" : "nikke-name-static"} style={{ fontSize: '0.75rem', color: 'var(--text-strong)' }}>
                          {n.name}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div style={{ padding: compact ? '10px 14px' : '15px 20px', borderTop: '1px solid var(--border-1)', backgroundColor: 'var(--surface-1)', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button onClick={onClose} style={{ padding: compact ? '9px 16px' : '10px 20px', backgroundColor: 'var(--border-1)', color: 'var(--text-strong)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            취소
          </button>
          <button onClick={() => { if(onConfirm) onConfirm(selectedSlots); }} style={{ padding: compact ? '9px 22px' : '10px 30px', backgroundColor: 'var(--accent-green)', color: 'var(--text-inverse)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: compact ? '1rem' : '1.1rem' }}>
            선택 완료
          </button>
        </div>

      </div>
    </div>
    </>
  );
}

export default NikkeSelectorModal;
