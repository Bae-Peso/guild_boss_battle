import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase, ensureSession, withRetry, unwrap } from '../lib/supabase';

const GameDataContext = createContext(null);

// 마이그레이션 전이라 테이블 자체가 없을 수 있는 경우 (relation does not exist)
const UNDEFINED_TABLE = '42P01';

export function GameDataProvider({ children }) {
  const [nikkes, setNikkes] = useState([]);
  const [gameIcons, setGameIcons] = useState([]);
  // 채팅 이모티콘: 패키지(카테고리)별로 묶어 [{ id, name, sort_order, emoticons: [...] }] 형태로 보관
  const [emoticonPacks, setEmoticonPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 재시도 스케줄러가 최신 상태를 보게 하기 위한 거울 (effect 재실행 없이 읽기용)
  const loadedRef = useRef(false);

  const fetchGameData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // JWT가 붙는 것을 먼저 보장한다. 없으면 RLS가 행을 전부 걸러서
      // 에러 없이 빈 배열이 돌아오고, 화면만 조용히 빈다. (lib/supabase.js 주석 참고)
      await ensureSession();

      await withRetry(async () => {
        const [nikkesRes, iconsRes, packsRes, emoticonsRes] = await Promise.all([
          supabase.from('nikkes').select('*').order('name'),
          supabase.from('game_icons').select('*'),
          // 이모티콘 테이블도 마이그레이션 전이면 없을 수 있으므로 graceful 처리
          supabase.from('emoticon_packs').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true }),
          supabase.from('emoticons').select('*').order('sort_order', { ascending: true }).order('created_at', { ascending: true })
        ]);

        // 니케 목록은 지휘·모의전·결산 전 화면의 전제다. 여기가 비면 사이트가 빈 것처럼 보이므로
        // 실패를 삼키지 않고 예외로 올려 재시도 대상으로 만든다.
        setNikkes(unwrap(nikkesRes, 'nikkes'));

        if (iconsRes.data) {
          setGameIcons(iconsRes.data);
        } else if (iconsRes.error && iconsRes.error.code !== UNDEFINED_TABLE) {
          throw Object.assign(new Error(`game_icons: ${iconsRes.error.message}`), { cause: iconsRes.error });
        }

        if (packsRes.data && emoticonsRes.data) {
          const byPack = {};
          emoticonsRes.data.forEach(e => { (byPack[e.pack_id] = byPack[e.pack_id] || []).push(e); });
          setEmoticonPacks(packsRes.data.map(p => ({ ...p, emoticons: byPack[p.id] || [] })));
        } else if (packsRes.error && packsRes.error.code !== UNDEFINED_TABLE) {
          throw Object.assign(new Error(`emoticon_packs: ${packsRes.error.message}`), { cause: packsRes.error });
        }
      }, { label: 'game-data' });

      loadedRef.current = true;
    } catch (err) {
      console.error('Failed to load game data:', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGameData();
  }, [fetchGameData]);

  // 첫 로드가 끝내 실패했다면 사용자가 F5를 누를 때까지 방치하지 않는다.
  // 네트워크가 돌아오거나 탭으로 되돌아온 시점에 한 번 더 시도한다.
  useEffect(() => {
    const retryIfEmpty = () => {
      if (loadedRef.current) return;
      if (document.visibilityState === 'hidden') return;
      fetchGameData();
    };

    window.addEventListener('online', retryIfEmpty);
    document.addEventListener('visibilitychange', retryIfEmpty);
    return () => {
      window.removeEventListener('online', retryIfEmpty);
      document.removeEventListener('visibilitychange', retryIfEmpty);
    };
  }, [fetchGameData]);

  return (
    <GameDataContext.Provider value={{ nikkes, gameIcons, emoticonPacks, refreshGameData: fetchGameData, loading, error }}>
      {children}
    </GameDataContext.Provider>
  );
}

export const useGameData = () => useContext(GameDataContext);
