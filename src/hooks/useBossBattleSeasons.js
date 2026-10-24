import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useDemo } from '../demo/DemoContext';

// 해당 길드가 실제 보스전 기록(union_raid_status)을 가진 시즌만 추려서 제공한다.
// - seasons: 최신순 시즌 목록
// - selectedSeason: 현재 선택된 시즌(기본=최신)
// - setSelectedSeason: 시즌 선택 변경
// - seasonsReady: 최초 시즌 조회가 끝났는지 여부(로딩 표시 종료 판단용)
// 'bossBattleDataChanged' 전역 이벤트가 오면 자동으로 다시 조회한다.
export function useBossBattleSeasons(guildId) {
  const demo = useDemo();
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState('');
  const [seasonsReady, setSeasonsReady] = useState(false);

  useEffect(() => {
    // 체험 모드: 목업 시즌 목록을 그대로 사용
    if (demo.isDemo) {
      const s = demo.data?.seasons || [];
      setSeasons(s);
      if (s.length > 0) setSelectedSeason(prev => prev || s[0].name);
      setSeasonsReady(true);
      return;
    }

    if (!guildId) return;
    let active = true;

    const fetchSeasons = async () => {
      try {
        const { data: allSeasons, error } = await supabase
          .from('raid_seasons')
          .select('*')
          .order('start_date', { ascending: false });
        if (error) throw error;

        const { data: statusData, error: stErr } = await supabase
          .from('union_raid_status')
          .select('global_raid_bosses!inner(season_name)')
          .eq('union_id', guildId);
        if (stErr) throw stErr;

        if (!active) return;

        const hasSeasons = new Set((statusData || []).map(d => d.global_raid_bosses.season_name));
        const filtered = (allSeasons || []).filter(s => hasSeasons.has(s.name));
        setSeasons(filtered);
        if (filtered.length > 0) setSelectedSeason(filtered[0].name);
      } catch (err) {
        console.error('Failed to fetch seasons:', err);
      } finally {
        if (active) setSeasonsReady(true);
      }
    };

    fetchSeasons();
    window.addEventListener('bossBattleDataChanged', fetchSeasons);
    return () => {
      active = false;
      window.removeEventListener('bossBattleDataChanged', fetchSeasons);
    };
  }, [guildId, demo.isDemo, demo.ready]);

  return { seasons, selectedSeason, setSelectedSeason, seasonsReady };
}
