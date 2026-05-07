import { notificationsAPI } from '../services/api.service';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function registerPushSubscription(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const vapidKey = await notificationsAPI.getVapidPublicKey().catch(() => null);
  if (!vapidKey) return;

  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    const json = subscription.toJSON();
    await notificationsAPI.registerDeviceToken({
      endpoint: json.endpoint!,
      p256dh: (json.keys as any)?.p256dh ?? '',
      auth: (json.keys as any)?.auth ?? '',
      device_type: 'web',
    });
  } catch (err) {
    console.warn('Push subscription failed:', err);
  }
}

export async function unregisterPushSubscription(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/sw.js');
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await notificationsAPI.unregisterDeviceToken(subscription.endpoint);
    await subscription.unsubscribe();
  } catch (err) {
    console.warn('Push unsubscription failed:', err);
  }
}
