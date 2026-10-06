// notifications.push_service — Web Push (VAPID) delivery, pywebpush → web-push.

import { createECDH, createPrivateKey } from 'node:crypto';
import webpush from 'web-push';
import { db } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { pyJsonDumps } from '../../lib/py.js';

/** settings.VAPID_* exactly as Django reads them. */
export function vapidConfig(): { privateKey: string; publicKey: string; email: string } {
  const defaultFrom = process.env.DEFAULT_FROM_EMAIL ?? 'homekonnet@gmail.com';
  return {
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    email: process.env.VAPID_CLAIMS_EMAIL ?? (defaultFrom || 'admin@homekonet.com'),
  };
}

/**
 * pywebpush only needs the private key; web-push also wants the public one, so
 * derive both from VAPID_PRIVATE_KEY (raw 32-byte base64url as printed by
 * generate_vapid_keys, or a PEM / base64 DER key, which pywebpush also accepts).
 */
function vapidKeys(privateKey: string): { privateKey: string; publicKey: string } {
  let raw: Buffer | null = null;
  const b = Buffer.from(privateKey.trim(), 'base64url');
  if (b.length === 32) raw = b;
  else {
    const key = privateKey.includes('BEGIN')
      ? createPrivateKey(privateKey)
      : createPrivateKey({ key: Buffer.from(privateKey.trim(), 'base64'), format: 'der', type: 'sec1' });
    const jwk = key.export({ format: 'jwk' });
    raw = Buffer.from(jwk.d!, 'base64url');
  }
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(raw);
  return { privateKey: raw.toString('base64url'), publicKey: ecdh.getPublicKey().toString('base64url') };
}

/** send_push_to_user(user, title, body, data=None, url='/') */
export async function sendPushToUser(userId: number, title: string, body: string, data: Record<string, unknown> | null = null, url = '/'): Promise<void> {
  const { privateKey, email } = vapidConfig();
  if (!privateKey) {
    logger.debug(`VAPID_PRIVATE_KEY not set — skipping push for user ${userId}`);
    return;
  }
  const tokens = await db.selectFrom('notifications_devicetoken').selectAll().where('user_id', '=', userId).orderBy('id').execute();
  if (!tokens.length) return;

  const payload = pyJsonDumps({ title, body, url, ...(data ?? {}) });
  const staleIds: number[] = [];
  for (const device of tokens) {
    try {
      const keys = vapidKeys(privateKey);
      await webpush.sendNotification(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        payload,
        { TTL: 0, vapidDetails: { subject: `mailto:${email}`, publicKey: keys.publicKey, privateKey: keys.privateKey } },
      );
    } catch (exc) {
      const status = (exc as { statusCode?: number }).statusCode;
      if (exc instanceof webpush.WebPushError && (status === 404 || status === 410)) staleIds.push(device.id);
      else logger.warn(`Push failed for device ${device.id}: ${exc}`);
    }
  }
  if (staleIds.length) await db.deleteFrom('notifications_devicetoken').where('id', 'in', staleIds).execute();
}
