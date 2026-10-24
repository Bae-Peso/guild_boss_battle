// 길드 단위 테이블의 postgres_changes 구독.
//
// 서버측 filter 없이 구독하면 다른 길드의 변경까지 전부 Realtime 서버로 들어오고,
// 변경 1건마다 접속자 전원에 대해 RLS 검사가 돈 뒤에야 버려진다(접속자 수 × 변경 수).
// INSERT/UPDATE 는 `union_id=eq.<id>` 로 서버에서 걸러 그 비용을 없앤다.
//
// DELETE 는 Realtime 이 filter 를 지원하지 않아(필터를 걸면 이벤트가 오지 않는다)
// 따로 필터 없이 구독한다. 삭제는 드물고, RLS 가 남의 길드 것은 걸러준다.
//
// handler 는 기존과 같은 payload(eventType 으로 분기)를 그대로 받는다.
export function onGuildChanges(channel, table, guildId, handler, events = ['INSERT', 'UPDATE', 'DELETE']) {
  const filter = `union_id=eq.${guildId}`;
  for (const event of events) {
    channel.on(
      'postgres_changes',
      event === 'DELETE'
        ? { event, schema: 'public', table }
        : { event, schema: 'public', table, filter },
      handler,
    );
  }
  return channel;
}

// ── 끊겼던 동안 놓친 INSERT 메우기 ─────────────────────────────────────────────
//
// postgres_changes 는 '지금 붙어 있는 구독자'에게만 보내고, 놓친 이벤트를 다시 보내주지 않는다.
// 네트워크 전환(와이파이↔LTE), 휴대폰 화면 꺼짐, 노트북 절전, 백그라운드 탭 등으로 소켓이 끊기면
// realtime-js 가 알아서 재접속은 하지만, 그 사이 들어온 메시지는 그대로 빠진다.
// 그 메시지는 채널을 나갔다 다시 들어와 목록을 새로 불러와야 보였다 → "남들 메시지가 늦게 뜬다".
//
// 그래서 채널이 다시 SUBSCRIBED 될 때(=재접속)와 탭/앱이 다시 보일 때, 마지막으로 받은 메시지
// 이후의 행을 한 번 조회해 실시간으로 온 것처럼 흘려보낸다. 이미 받은 id 는 다시 내보내지 않는다.
//
//   fetchRows({ since, limit }) : since(서버 created_at) 이후의 최신 limit 개를 오름차순으로.
//                                 since 가 null 이면 가장 최신 limit 개.
//   onRow(row)                  : 새 행 1건 처리(실시간 INSERT 핸들러와 같은 것).
//
// 사용법: channel.on(INSERT, p => catchUp.handle(p.new)); channel.subscribe(catchUp.onStatus);
//         정리할 때 catchUp.dispose().
const CATCH_UP_LIMIT = 200;
const SEEN_LIMIT = 500;
const HIDDEN_RESYNC_MS = 5000; // 이보다 오래 가려져 있다 돌아오면 바로 메운다(소켓이 죽은 걸 알아채기 전에)

export function createCatchUp({ label, fetchRows, onRow }) {
  let lastAt = null;          // 받은 행 중 가장 최신 created_at — 클라이언트 시계가 아니라 서버 값
  let subscribedOnce = false;
  let running = false;
  let pending = false;
  let disposed = false;
  let hiddenAt = null;
  const seen = new Set();

  const remember = (row) => {
    seen.add(row.id);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
    if (!lastAt || row.created_at > lastAt) lastAt = row.created_at;
  };

  const handle = (row) => {
    if (disposed || !row?.id || seen.has(row.id)) return;
    remember(row);
    onRow(row);
  };

  const run = async () => {
    if (disposed) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      if (!lastAt) {
        // 아직 기준점이 없다(첫 구독 직후) — 가장 최신 1건의 시각만 기준으로 잡는다.
        // 그 1건은 이미 있던 메시지이므로 받은 것으로 기록한다. 기록하지 않으면 다음 메우기에서
        // since(>=) 조회에 다시 걸려 새 메시지처럼 흘러가, 탭 복귀/재접속 때마다 읽은 방에 안읽음 점이 켜졌다.
        const rows = await fetchRows({ since: null, limit: 1 });
        if (!disposed && !lastAt) {
          if (rows[0]?.id) seen.add(rows[0].id);
          lastAt = rows[0]?.created_at ?? '1970-01-01T00:00:00Z';
        }
      } else {
        const rows = await fetchRows({ since: lastAt, limit: CATCH_UP_LIMIT });
        rows.forEach(handle);
      }
    } catch (err) {
      console.warn(`[realtime:${label}] 놓친 메시지 조회 실패`, err);
    } finally {
      running = false;
      if (pending && !disposed) { pending = false; run(); }
    }
  };

  const onStatus = (status, err) => {
    if (disposed) return;
    if (status === 'SUBSCRIBED') {
      // 첫 구독은 기준점만 잡고, 그 뒤의 SUBSCRIBED 는 재접속이므로 그 사이 것을 메운다.
      subscribedOnce = true;
      run();
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[realtime:${label}] ${status}`, err || '');
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (subscribedOnce && away >= HIDDEN_RESYNC_MS) run();
  };
  const onOnline = () => { if (subscribedOnce) run(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);

  const dispose = () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };

  return { handle, onStatus, dispose };
}
