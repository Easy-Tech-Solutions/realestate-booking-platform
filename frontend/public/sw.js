/* Service worker for Web Push notifications */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'HomeKonet', body: event.data.text() };
  }

  const title = payload.title || 'HomeKonet';
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-72.png',
    data: { url: payload.url || '/' },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
