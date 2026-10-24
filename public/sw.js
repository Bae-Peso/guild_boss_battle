/* 길드 보스전 지휘소 — Web Push 전용 서비스 워커 (오프라인 캐싱 없음, 의존성 0 유지) */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil((async () => {
    // 포커스된 창이 있으면 페이지 쪽(realtime 구독)이 이미 토스트/알림을 표시하므로 skip
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((c) => c.focused)) return;

    await self.registration.showNotification(data.title || '길드 보스전 지휘소', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag, // 페이지 쪽 Notification과 같은 tag → 중복 시 하나로 병합
      data: { url: data.url || '/workspace' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/workspace';

  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      if (existing.navigate) await existing.navigate(url).catch(() => {});
    } else {
      await self.clients.openWindow(url);
    }
  })());
});
