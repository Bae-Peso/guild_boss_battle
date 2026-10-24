import { supabase } from './supabase';

// 직전 시즌의 싱크로 레벨을 구한다. (모의전 등록 시 '레벨 안 올림' 경고용)
//
// 우선순위는 결산 페이지의 '지난 레벨' 기본값과 같다.
//  1) 결산 스냅샷(union_settlement_members) — 관리자 수기 수정(synchro_override)이 반영된 값
//  2) 스냅샷이 없으면 그 시즌 완료 타수(mock_battles)의 마지막 싱크로에서 파생
//
// currentSeason 보다 앞선 시즌 중 값이 있는 가장 최근 시즌을 쓴다.
// 값을 못 찾으면 null 을 돌려준다(= 비교할 지난 기록이 없음).
export async function fetchPrevSeasonSynchro(guildId, currentSeason, memberKey) {
  if (!guildId || !currentSeason || !memberKey) return null;
  try {
    const { data: seasons } = await supabase
      .from('raid_seasons').select('name, start_date').order('start_date', { ascending: false });
    const idx = (seasons || []).findIndex(s => s.name === currentSeason);
    if (idx < 0) return null;
    const prevNames = (seasons || []).slice(idx + 1).map(s => s.name); // 최신순
    if (prevNames.length === 0) return null;

    // 1) 확정 스냅샷
    const { data: snaps } = await supabase
      .from('union_settlement_members')
      .select('season_name, synchro_level')
      .eq('union_id', guildId).eq('member_key', memberKey)
      .in('season_name', prevNames)
      .not('synchro_level', 'is', null);
    if (snaps && snaps.length > 0) {
      // prevNames 가 최신순이므로 가장 앞선 인덱스가 가장 최근 시즌이다.
      let best = null;
      snaps.forEach(s => {
        const rank = prevNames.indexOf(s.season_name);
        if (rank >= 0 && (best === null || rank < best.rank)) best = { rank, ...s };
      });
      if (best) return { level: Number(best.synchro_level), seasonName: best.season_name };
    }

    // 2) 폴백: 바로 직전 시즌의 완료 타수에서 파생 (결산을 확정하지 않고 넘어간 경우)
    const prevName = prevNames[0];
    const { data: pStatuses } = await supabase
      .from('union_raid_status')
      .select('id, global_raid_bosses!inner ( season_name )')
      .eq('union_id', guildId).eq('global_raid_bosses.season_name', prevName);
    const ids = (pStatuses || []).map(s => s.id);
    if (ids.length === 0) return null;

    let q = supabase.from('mock_battles')
      .select('synchro_level, completed_at')
      .eq('union_id', guildId).eq('status', 'completed').in('boss_status_id', ids)
      .not('synchro_level', 'is', null)
      .order('completed_at', { ascending: false }).limit(1);
    if (memberKey.startsWith('manual:')) {
      q = q.eq('is_admin_written', true).eq('manual_nickname', memberKey.slice('manual:'.length));
    } else {
      q = q.eq('is_admin_written', false).eq('user_id', memberKey.slice('user:'.length));
    }
    const { data: rows } = await q;
    if (rows && rows.length > 0) return { level: Number(rows[0].synchro_level), seasonName: prevName };
    return null;
  } catch (err) {
    console.error('직전 시즌 싱크로 조회 실패:', err);
    return null; // 조회 실패로 등록 자체를 막지는 않는다
  }
}
