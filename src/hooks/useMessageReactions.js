import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const TABLE = 'message_reactions';
const EMPTY = [];

/**
 * 메시지 반응(message_reactions) 로딩 / 실시간 반영 / 토글.
 * 일반 채팅과 지휘 채팅이 대상 컬럼만 다르고 나머지가 같아 한 훅으로 쓴다.
 *
 * @param targetColumn 'message_id'(일반 채팅) | 'raid_message_id'(지휘 채팅)
 * @param messages     화면에 올라와 있는 메시지 배열 (id 만 사용)
 * @param userId       현재 사용자
 * @param resetKey     채널/시즌/방 식별자. 바뀌면 쌓아둔 반응을 버린다
 * @param demo         useDemo() 결과. 체험 모드면 DB 대신 목업 스토어를 쓴다
 * @returns { reactionsByMessage, toggle, markFresh }
 *   markFresh(id): 실시간으로 막 도착했거나 방금 보낸 메시지에 대해 호출한다.
 *   새 메시지에는 반응이 있을 수 없고 이후 달리는 반응은 실시간 구독으로 들어오므로 조회를 건너뛴다.
 *   (이 조회를 받는 사람 전원이 메시지마다 보내고 있었다.)
 */
export function useMessageReactions({ targetColumn, messages, userId, resetKey, demo }) {
  const isDemo = !!demo?.isDemo;
  const [rows, setRows] = useState([]);

  // 이미 조회한 메시지 id — 과거 메시지를 더 불러왔을 때 그 몫만 추가로 가져오기 위함.
  const fetchedRef = useRef(new Set());
  // resetKey 가 바뀐 뒤 도착한 이전 방의 응답을 버리기 위한 세대 번호.
  const genRef = useRef(0);

  useEffect(() => {
    genRef.current += 1;
    fetchedRef.current = new Set();
    setRows([]);
  }, [resetKey, targetColumn]);

  const ids = useMemo(() => (messages || []).map(m => m.id), [messages]);
  // 실시간 핸들러가 '지금 화면에 있는 메시지'인지 판단할 때 쓴다.
  const idSetRef = useRef(new Set());

  const markFresh = useCallback((id) => {
    if (id) fetchedRef.current.add(id);
  }, []);

  useEffect(() => {
    const idSet = new Set(ids);
    idSetRef.current = idSet;
    // 화면에서 빠진 메시지(다른 방, 윈도잉으로 잘려 나간 쪽)의 반응은 들고 있지 않는다.
    // 다시 불러오면 그때 새로 조회한다.
    for (const id of fetchedRef.current) {
      if (!idSet.has(id)) fetchedRef.current.delete(id);
    }
    setRows(prev => {
      const kept = prev.filter(r => idSet.has(r[targetColumn]));
      return kept.length === prev.length ? prev : kept;
    });
  }, [ids, targetColumn]);

  useEffect(() => {
    if (isDemo || !userId) return;
    const missing = ids.filter(id => id && !fetchedRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach(id => fetchedRef.current.add(id));

    const gen = genRef.current;
    (async () => {
      const { data, error } = await supabase.from(TABLE).select('*').in(targetColumn, missing);
      if (gen !== genRef.current) return; // 그 사이 방이 바뀌었다
      if (error) {
        // 다음 렌더에서 다시 시도할 수 있도록 '조회함' 표시를 되돌린다.
        console.error('반응 로드 실패:', error);
        missing.forEach(id => fetchedRef.current.delete(id));
        return;
      }
      if (!data || data.length === 0) return;
      setRows(prev => {
        const seen = new Set(prev.map(r => r.id));
        // 응답을 기다리는 사이 화면에서 빠진 메시지의 몫은 버린다.
        const added = data.filter(r => !seen.has(r.id) && idSetRef.current.has(r[targetColumn]));
        return added.length > 0 ? [...prev, ...added] : prev;
      });
    })();
  }, [ids, targetColumn, userId, isDemo]);

  // 실시간. 서버측 filter 는 컬럼 하나의 등호만 걸 수 있어(메시지 id 목록을 못 넣는다)
  // 전체를 구독하고 클라이언트에서 가른다. RLS 가 걸려 있어 남의 길드 것은 애초에 오지 않는다.
  useEffect(() => {
    if (isDemo || !userId) return;
    const channel = supabase.channel(`${TABLE}_${targetColumn}_${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: TABLE }, payload => {
        const row = payload.new;
        if (!row?.[targetColumn]) return; // 다른 쪽 채팅(일반↔지휘)의 반응
        if (!idSetRef.current.has(row[targetColumn])) return; // 지금 화면에 없는 메시지의 반응
        setRows(prev => prev.some(r => r.id === row.id) ? prev : [...prev, row]);
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: TABLE }, payload => {
        // REPLICA IDENTITY 가 기본값이라 DELETE 페이로드에는 id 만 온다.
        // 지울 행은 이미 들고 있으므로 id 하나면 충분하다.
        const id = payload.old?.id;
        if (id) setRows(prev => prev.filter(r => r.id !== id));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [targetColumn, userId, isDemo]);

  // 체험 모드의 반응은 목업 스토어에 있다(새로고침 전까지 유지).
  const demoRows = isDemo ? (demo?.data?.messageReactions || EMPTY) : null;
  const allRows = isDemo ? demoRows : rows;

  // toggle 이 목록이 바뀔 때마다 새로 만들어지지 않도록 최신 목록을 ref 로도 들고 있는다.
  // (effect 는 다음 이벤트 처리 전에 반드시 실행되므로, 클릭 시점의 값은 항상 최신이다)
  const rowsRef = useRef(allRows);
  useEffect(() => { rowsRef.current = allRows; }, [allRows]);

  const reactionsByMessage = useMemo(() => {
    const map = {};
    allRows.forEach(r => {
      const key = r[targetColumn];
      if (!key) return;
      (map[key] ||= []).push(r);
    });
    return map;
  }, [allRows, targetColumn]);

  /** 내가 이미 단 반응이면 떼고, 아니면 단다. 화면에는 응답을 기다리지 않고 먼저 반영한다. */
  const toggle = useCallback(async (messageId, emoji) => {
    if (!userId || !messageId || !emoji) return;

    if (isDemo) {
      demo.toggleMessageReaction({ targetColumn, messageId, emoji });
      return;
    }

    const mine = rowsRef.current.find(
      r => r[targetColumn] === messageId && r.user_id === userId && r.emoji === emoji
    );

    if (mine) {
      setRows(prev => prev.filter(r => r.id !== mine.id));
      const { error } = await supabase.from(TABLE).delete().eq('id', mine.id);
      if (error) {
        console.error('반응 삭제 실패:', error);
        setRows(prev => prev.some(r => r.id === mine.id) ? prev : [...prev, mine]);
      }
      return;
    }

    // 임시 행으로 먼저 그리고, 저장된 행이 오면 바꿔 끼운다.
    const tempId = `temp-${messageId}-${emoji}-${Date.now()}`;
    setRows(prev => [...prev, {
      id: tempId, [targetColumn]: messageId, user_id: userId, emoji, created_at: new Date().toISOString(),
    }]);

    const { data, error } = await supabase
      .from(TABLE)
      .insert({ [targetColumn]: messageId, user_id: userId, emoji })
      .select()
      .single();

    if (error) {
      console.error('반응 추가 실패:', error);
      setRows(prev => prev.filter(r => r.id !== tempId));
      return;
    }
    setRows(prev => {
      const without = prev.filter(r => r.id !== tempId);
      return without.some(r => r.id === data.id) ? without : [...without, data];
    });
  }, [targetColumn, userId, isDemo, demo]);

  return { reactionsByMessage, toggle, markFresh };
}
