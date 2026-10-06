// notifications — /api/notifications/ (port of notifications/views.py + urls.py).
//
// urls.py order: preferences/, device-token/, vapid-public-key/, then the
// DefaultRouter for NotificationViewSet (list, read-all, unread-count,
// detail, unread, read — each with its .<format> suffix variant — and the
// router's api-root, which is shadowed by the list route as in Django).

import type { NextFunction, Request, Response } from 'express';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { buildAbsoluteUri } from '../../lib/drf.js';
import { NotFound, UnsupportedMediaType, ValidationError } from '../../lib/errors.js';
import { multipart } from '../../lib/upload.js';
import { AllowAny, IsAuthenticated, negotiatedView, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { getOrCreatePreferences } from '../../domain/notifications.js';
import { pyStr, pyStrip, pyTypeName } from '../../lib/py.js';
import { drfBoolean, PREFERENCE_SERIALIZER_FIELDS, serializeNotification, serializePreferences } from './serializers.js';

// ---- DRF request/response plumbing not (yet) in lib/view.ts ------------------------------

const last = (v: unknown): unknown => (Array.isArray(v) ? v[v.length - 1] : v);

/** request.data: {} for an empty body, 415 for an unsupported content type, QueryDict-style last values for forms. */
async function requestData(req: Request, res: Response): Promise<unknown> {
  const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (req.is('multipart/form-data')) {
    await new Promise<void>((resolve, reject) => multipart(req, res, ((e?: unknown) => (e ? reject(e) : resolve())) as NextFunction));
    return Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, last(v)]));
  }
  if (req.is('application/x-www-form-urlencoded')) {
    return Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, last(v)]));
  }
  if (req.is(['application/json', 'application/*+json'])) return req.body ?? {};
  if (hasBody) throw new UnsupportedMediaType(req.headers['content-type'] ?? '');
  return {};
}

/** dict.get(key, default) on request.data — AttributeError (→ 500) when data isn't a mapping. */
function dataGet(data: unknown, key: string, dflt: unknown): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new TypeError(`'${pyTypeName(data)}' object has no attribute 'get'`);
  return key in (data as object) ? (data as Record<string, unknown>)[key] : dflt;
}

/** value.strip() — AttributeError (→ 500) for non-strings, like Python. */
function strip(v: unknown): string {
  if (typeof v !== 'string') throw new TypeError(`'${pyTypeName(v)}' object has no attribute 'strip'`);
  return pyStrip(v);
}

/** str(value) as Django stores it in a CharField (None → NOT NULL violation → 500). */
function pyStrValue(v: unknown): string {
  if (v === null || v === undefined) throw new TypeError('null value in column "device_type" violates not-null constraint');
  return pyStr(v);
}

/**
 * The @action methods (read, mark_unread, read_all, unread_count) don't accept
 * the `format` kwarg DRF passes for their `.<format>` suffix routes, so Django
 * raises TypeError → 500 once the view runs (after auth/permissions/throttles,
 * before any side effect). Reproduced on purpose.
 */
function rejectFormatKwarg(req: ApiRequest, action: string) {
  if ((req.params as Record<string, string | undefined>).format !== undefined) {
    throw new TypeError(`NotificationViewSet.${action}() got an unexpected keyword argument 'format'`);
  }
}

// ---- NotificationViewSet -------------------------------------------------------------------

/** get_queryset(): null when the user turned in-app notifications off (Notification.objects.none()). */
async function notificationQueryset(req: ApiRequest) {
  const userId = req.user!.id;
  const prefs = await db.selectFrom('notifications_notificationpreference').select('in_app_enabled').where('user_id', '=', userId).orderBy('id').executeTakeFirst();
  if (prefs && !prefs.in_app_enabled) return null;
  let qs = db.selectFrom('notifications_notification').selectAll().where('user_id', '=', userId);
  const isRead = last(req.query.is_read);
  if (typeof isRead === 'string') qs = qs.where('is_read', '=', isRead.toLowerCase() === 'true');
  const type = last(req.query.type);
  if (typeof type === 'string' && type) qs = qs.where('notification_type', '=', type);
  return qs;
}

const BIGINT_MAX = 9223372036854775807n;

/** get_object(): pk → int() like Python (else Http404 "Not found."), then the scoped lookup. */
async function getNotification(req: ApiRequest) {
  let raw = String(req.params.pk ?? '');
  try { raw = decodeURIComponent(raw); } catch { /* keep raw */ }
  const s = raw.trim();
  if (!/^[+-]?\d+(?:_\d+)*$/.test(s)) throw new NotFound();
  const pk = BigInt(s.replace(/_/g, ''));
  const qs = await notificationQueryset(req);
  const missing = new NotFound('No Notification matches the given query.');
  if (!qs || pk > BIGINT_MAX || pk < -BIGINT_MAX - 1n) throw missing;
  const n = await qs.where('id', '=', pk.toString() as unknown as number).executeTakeFirst();
  if (!n) throw missing;
  return n;
}

const r = djangoRouter('api/notifications/');

// ---- NotificationPreferenceView --------------------------------------------------------------
r.path('preferences/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    return serializePreferences(await getOrCreatePreferences(req.user!.id));
  },
  async PATCH(req, res) {
    const prefs = await getOrCreatePreferences(req.user!.id);
    const data = await requestData(req, res);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      const got = data === null ? 'NoneType' : Array.isArray(data) ? 'list' : typeof data === 'string' ? 'str' : typeof data === 'boolean' ? 'bool' : Number.isInteger(data) ? 'int' : 'float';
      throw new ValidationError({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${got}.`] });
    }
    const errors: Record<string, string[]> = {};
    const updates: Record<string, boolean> = {};
    for (const f of PREFERENCE_SERIALIZER_FIELDS) {
      if (!(f in data)) continue;
      const v = drfBoolean((data as Record<string, unknown>)[f]);
      if (v.ok) updates[f] = v.value;
      else errors[f] = [v.error];
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const saved = await db.updateTable('notifications_notificationpreference')
      .set({ ...updates, updated_at: nowPg() })
      .where('id', '=', prefs.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return serializePreferences(saved);
  },
}));

// ---- device_token -------------------------------------------------------------------------------
async function deviceToken(req: ApiRequest, res: Response) {
  const data = await requestData(req, res);
  const endpoint = strip(dataGet(data, 'endpoint', ''));
  const p256dh = strip(dataGet(data, 'p256dh', ''));
  const authKey = strip(dataGet(data, 'auth', ''));
  const deviceType = dataGet(data, 'device_type', 'web');

  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });

  if (req.method === 'POST') {
    if (!p256dh || !authKey) return res.status(400).json({ error: 'p256dh and auth are required' });
    const userId = req.user!.id;
    const created = await db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom('notifications_devicetoken').select('id')
        .where('user_id', '=', userId).where('endpoint', '=', endpoint).forUpdate().executeTakeFirst();
      if (existing) {
        await trx.updateTable('notifications_devicetoken')
          .set({ p256dh, auth: authKey, device_type: pyStrValue(deviceType) })
          .where('id', '=', existing.id).execute();
        return false;
      }
      await trx.insertInto('notifications_devicetoken').values({
        user_id: userId, endpoint, p256dh, auth: authKey, device_type: pyStrValue(deviceType), created_at: nowPg(),
      }).execute();
      return true;
    });
    return res.status(created ? 201 : 200).json({ status: 'registered' });
  }

  await db.deleteFrom('notifications_devicetoken').where('user_id', '=', req.user!.id).where('endpoint', '=', endpoint).execute();
  return res.status(200).json({ status: 'unregistered' });
}
r.path('device-token/', negotiatedView({ permissions: [IsAuthenticated], POST: deviceToken, DELETE: deviceToken }));

// ---- vapid_public_key ---------------------------------------------------------------------------
r.path('vapid-public-key/', negotiatedView({
  permissions: [AllowAny],
  GET(_req, res) {
    const key = process.env.VAPID_PUBLIC_KEY ?? '';
    if (!key) return res.status(503).json({ error: 'Push notifications not configured' });
    return res.json({ public_key: key });
  },
}));

// ---- router: NotificationViewSet -------------------------------------------------------------------
const list = negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const qs = await notificationQueryset(req);
    if (!qs) return [];
    const rows = await qs.orderBy('created_at', 'desc').execute();
    return rows.map(serializeNotification);
  },
});
r.rePath('^$', list);
r.rePath('^\\.(?P<format>[a-z0-9]+)/?$', list);

const readAll = negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req) {
    rejectFormatKwarg(req, 'read_all');
    const result = await db.updateTable('notifications_notification')
      .set({ is_read: true, read_at: nowPg() })
      .where('user_id', '=', req.user!.id)
      .where('is_read', '=', false)
      .executeTakeFirst();
    return { marked_read: Number(result.numUpdatedRows) };
  },
});
r.rePath('^read-all/$', readAll);
r.rePath('^read-all\\.(?P<format>[a-z0-9]+)/?$', readAll);

const unreadCount = negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    rejectFormatKwarg(req, 'unread_count');
    const prefs = await db.selectFrom('notifications_notificationpreference').select('in_app_enabled').where('user_id', '=', req.user!.id).orderBy('id').executeTakeFirst();
    if (prefs && !prefs.in_app_enabled) return { unread_count: 0 };
    const { count } = await db.selectFrom('notifications_notification').select((eb) => eb.fn.countAll<number>().as('count'))
      .where('user_id', '=', req.user!.id).where('is_read', '=', false).executeTakeFirstOrThrow();
    return { unread_count: Number(count) };
  },
});
r.rePath('^unread-count/$', unreadCount);
r.rePath('^unread-count\\.(?P<format>[a-z0-9]+)/?$', unreadCount);

const detail = negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    return serializeNotification(await getNotification(req));
  },
  async DELETE(req, res) {
    const n = await getNotification(req);
    await db.deleteFrom('notifications_notification').where('id', '=', n.id).execute();
    res.status(204).end();
  },
});
r.rePath('^(?P<pk>[^/.]+)/$', detail);
r.rePath('^(?P<pk>[^/.]+)\\.(?P<format>[a-z0-9]+)/?$', detail);

const markUnread = negotiatedView({
  permissions: [IsAuthenticated],
  async PATCH(req) {
    rejectFormatKwarg(req, 'mark_unread');
    const n = await getNotification(req);
    const saved = await db.updateTable('notifications_notification').set({ is_read: false, read_at: null })
      .where('id', '=', n.id).returningAll().executeTakeFirstOrThrow();
    return serializeNotification(saved);
  },
});
r.rePath('^(?P<pk>[^/.]+)/unread/$', markUnread);
r.rePath('^(?P<pk>[^/.]+)/unread\\.(?P<format>[a-z0-9]+)/?$', markUnread);

const markRead = negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req) {
    rejectFormatKwarg(req, 'read');
    let n = await getNotification(req);
    if (!n.is_read) {
      n = await db.updateTable('notifications_notification').set({ is_read: true, read_at: nowPg() })
        .where('id', '=', n.id).returningAll().executeTakeFirstOrThrow();
    }
    return serializeNotification(n);
  },
});
r.rePath('^(?P<pk>[^/.]+)/read/$', markRead);
r.rePath('^(?P<pk>[^/.]+)/read\\.(?P<format>[a-z0-9]+)/?$', markRead);

// DefaultRouter's APIRootView — registered for completeness; the list route above matches first.
const apiRoot = negotiatedView({
  permissions: [AllowAny],
  GET(req) {
    return { '': buildAbsoluteUri(req, '/api/notifications/') };
  },
});
r.path('', apiRoot);
r.path('<drf_format_suffix:format>', apiRoot);
