import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { useDemo } from '../../../demo/DemoContext';
import { useBossBattleSeasons } from '../../../hooks/useBossBattleSeasons';
import { useGameData } from '../../../contexts/GameDataContext';
import BossImage from '../../../components/BossImage';

// 속성 아이콘 이모지 폴백 (game_icons 미등록 시). 모의전 대시보드와 같은 규칙.
const ELEMENT_ICON = { '작열': '🔥', '수냉': '💧', '풍압': '🌪️', '전격': '⚡', '철갑': '🛡️' };

/**
 * 모의전 네비: 보스 1~5 바로가기 카드.
 * 데스크톱 우측 사이드바 '모의전' 탭과 모바일 모의전 랜딩이 공유한다.
 * onSelectBoss(bossNum)로 이동을 위임한다(라우트 이동은 호스트가 결정).
 *
 * 카드에는 현재 시즌 보스의 이미지와 이름, 그 아래 약점 속성 · 보스 등급을 보여준다 —
 * 번호만으로는 어떤 보스인지, 무엇을 데려가야 하는지 알 수 없어서다.
 * 보스 정보를 못 불러오면(시즌 미설정 등) 번호만 있는 기존 모양으로 자연스럽게 폴백한다.
 */
export default function MockBossNav({ guild, onSelectBoss }) {
  const demo = useDemo();
  const { selectedSeason } = useBossBattleSeasons(guild?.id);
  const { gameIcons } = useGameData();
  const elementIconUrl = (element) =>
    gameIcons?.find(i => i.category === 'element' && String(i.name) === String(element))?.image_url || null;
  const [bosses, setBosses] = useState({}); // boss_number -> boss row

  useEffect(() => {
    if (!selectedSeason) return;

    if (demo.isDemo) {
      const map = {};
      (demo.data?.bossBattleStatuses || []).forEach(s => {
        const b = s.global_raid_bosses;
        if (b?.season_name === selectedSeason) map[b.boss_number] = b;
      });
      setBosses(map);
      return;
    }

    let alive = true;
    (async () => {
      const { data } = await supabase
        .from('global_raid_bosses')
        .select('boss_number, name, element, boss_grade, image_url, image_alt')
        .eq('season_name', selectedSeason);
      if (!alive) return;
      const map = {};
      (data || []).forEach(b => { map[b.boss_number] = b; });
      setBosses(map);
    })();
    return () => { alive = false; };
  }, [selectedSeason, demo.isDemo, demo.data]);

  return (
    <div className="nav-section" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ color: 'var(--accent-green)', flexShrink: 0, paddingBottom: '10px' }}>🎯 보스별 모의전 이동</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '0 10px' }}>
        {[1, 2, 3, 4, 5].map(bossNum => {
          const boss = bosses[bossNum];
          return (
            <button
              key={bossNum}
              onClick={() => onSelectBoss(bossNum)}
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--surface-2)',
                border: '1px solid var(--border-1)',
                borderRadius: '8px',
                color: 'var(--text-strong)',
                fontWeight: 'bold',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                transition: 'background 0.2s'
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-4)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
            >
              <div style={{ width: '24px', height: '24px', flexShrink: 0, borderRadius: '50%', backgroundColor: 'var(--accent-green)', color: 'var(--text-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {bossNum}
              </div>
              {boss ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '2px', minWidth: 0, flex: 1 }}>
                  {/* 보스 이미지는 배너처럼 — 카드 폭을 꽉 채우고 상하를 잘라 크게 보여준다.
                      잘린 위/아래 경계는 fade 마스크가 카드 배경으로 흐려준다. */}
                  <div style={{ width: '100%', height: '84px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <BossImage
                      url={boss.image_url} alt={boss.image_alt} element={boss.element}
                      size={84} fit="cover" fade={0.1}
                      fallbackFit="contain" fallbackSize={48}
                      style={{ width: '100%', height: '100%', borderRadius: 0 }}
                    />
                  </div>
                  <span style={{ fontSize: '0.9rem', textAlign: 'center', wordBreak: 'keep-all', lineHeight: 1.2 }}>{boss.name}</span>
                  {/* 약점 속성 · 보스 등급 한 줄. 둘 중 하나만 있어도 그것만 보여준다. */}
                  {(boss.element || boss.boss_grade) && (
                    <span style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                      fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--text-dim)',
                      wordBreak: 'keep-all', lineHeight: 1.2
                    }}>
                      {boss.element && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          {elementIconUrl(boss.element)
                            ? <img src={elementIconUrl(boss.element)} alt={boss.element} style={{ width: '1.1em', height: '1.1em', objectFit: 'contain' }} />
                            : <span>{ELEMENT_ICON[boss.element] || ''}</span>}
                          {boss.element}
                        </span>
                      )}
                      {boss.element && boss.boss_grade && <span aria-hidden="true">·</span>}
                      {boss.boss_grade && <span>{boss.boss_grade}</span>}
                    </span>
                  )}
                </div>
              ) : (
                <span style={{ minWidth: 0, flex: 1 }}>{bossNum}번 보스 모의전 바로 가기</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
