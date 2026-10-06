// trustsafety — /api/trust-safety/ (port of trustsafety/views.py + urls.py).

import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { HttpResponseError, notFoundFor } from '../../lib/errors.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { hasAnyPermission } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import { delayAiScoring } from '../../domain/aiscoring.js';
import { dataGet, ormPk, parseRequest, pkParam, pyStrip, pystr, runSerializer } from '../listings/drf.js';
import { runAllDetectors } from './detection.js';
import { fraudFlagStr, serializeFingerprints, serializeFraudFlags, serializeLocations } from './models.js';

const r = djangoRouter('api/trust-safety/');

/** _require_trust_safety(request) */
async function requireTrustSafety(req: ApiRequest): Promise<void> {
  const u = req.user;
  const ok = isSuperadminStaff(u) && ((await requireDepartment(u, 'trust_safety')) || (await hasAnyPermission(u, 'trust_safety.flags'))
    || (await hasAnyPermission(u, 'trust_safety.bans')));
  if (!ok) throw new HttpResponseError(403, { error: 'Trust & Safety access required' });
}

const view = (opts: Parameters<typeof apiView>[0]) => apiView({ permissions: [IsAuthenticated], ...opts });
const isTruthy = (v: unknown) => !(v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length)
  || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v as object).length));

r.path('fraud-flags/', view({
  async GET(req) {
    await requireTrustSafety(req);
    const raw = req.query.status;
    const st = raw === undefined ? 'open' : String(Array.isArray(raw) ? raw[raw.length - 1] : raw);
    let q = db.selectFrom('trustsafety_fraudflag').selectAll();
    if (st && st !== 'all') q = q.where('status', '=', st);
    return serializeFraudFlags(await q.orderBy('created_at', 'desc').execute());
  },
}));

r.path('fraud-flags/scan/', view({
  async POST(req) {
    await requireTrustSafety(req);
    const results = await runAllDetectors();
    const created = Object.values(results).reduce((a, v) => a + v.length, 0);
    await logAdminAction(req, 'fraud_flag.scan', { reason: '', metadata: { created } });
    return { created, by_detector: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.length])) };
  },
}));

r.path('fraud-flags/manual/', view({
  async POST(req, res) {
    await requireTrustSafety(req);
    const { data } = await parseRequest(req, res);
    const userId = dataGet(data, 'user');
    const details = pyStrip(pystr(dataGet(data, 'details', '')));
    const severity = dataGet(data, 'severity', 'medium');
    if (!isTruthy(userId) || !details) return res.status(400).json({ error: 'user and details are required' });
    const pk = ormPk(userId);
    const target = pk === null ? undefined : await db.selectFrom('users_user').select('id').where('id', '=', pk).executeTakeFirst();
    if (!target) throw notFoundFor('User');
    const flag = await db.insertInto('trustsafety_fraudflag').values({
      user_id: target.id, flag_type: 'manual', severity: severity === null ? (null as never) : pystr(severity), status: 'open', details,
      ai_score: null, ai_rationale: '', reviewed_by_id: null, reviewed_at: null, review_notes: '', created_at: nowPg(),
    }).returningAll().executeTakeFirstOrThrow();
    await delayAiScoring('score_fraud_flag_task', flag.id);
    await logAdminAction(req, 'fraud_flag.create', { target: auditTarget('FraudFlag', flag.id, fraudFlagStr(flag)), reason: details });
    return res.status(201).json((await serializeFraudFlags([flag]))[0]);
  },
}));

r.path('fraud-flags/<int:pk>/review/', view({
  async POST(req, res) {
    await requireTrustSafety(req);
    const pk = pkParam(req.params.pk);
    const flag = pk === null ? undefined : await db.selectFrom('trustsafety_fraudflag').selectAll().where('id', '=', pk).executeTakeFirst();
    if (!flag) throw notFoundFor('FraudFlag');
    const { data } = await parseRequest(req, res);
    const decision = dataGet(data, 'status');
    if (decision !== 'dismissed' && decision !== 'confirmed') return res.status(400).json({ error: 'status must be "dismissed" or "confirmed"' });
    const notes = dataGet(data, 'notes', '');
    const saved = await db.updateTable('trustsafety_fraudflag').set({
      status: decision, review_notes: notes === null ? (null as never) : pystr(notes), reviewed_by_id: req.user!.id, reviewed_at: nowPg(),
    }).where('id', '=', flag.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'fraud_flag.review', {
      target: auditTarget('FraudFlag', saved.id, fraudFlagStr(saved)), reason: isTruthy(notes) ? pystr(notes) : '', metadata: { decision },
    });
    return (await serializeFraudFlags([saved]))[0];
  },
}));

const fingerprintStr = (fp: string) => `Blocked fingerprint ${[...fp].slice(0, 12).join('')}…`;

r.path('blocked-fingerprints/', view({
  async GET(req) {
    await requireTrustSafety(req);
    const rows = await db.selectFrom('trustsafety_blockedfingerprint').leftJoin('users_user', 'users_user.id', 'trustsafety_blockedfingerprint.blocked_by_id')
      .selectAll('trustsafety_blockedfingerprint').execute();
    return serializeFingerprints(rows);
  },
  async POST(req, res) {
    await requireTrustSafety(req);
    const { data } = await parseRequest(req, res);
    const v = await runSerializer(data, [
      ['fingerprint', {
        kind: 'char', maxLength: 128,
        validators: [async (val) => ((await db.selectFrom('trustsafety_blockedfingerprint').select('id').where('fingerprint', '=', val as string).executeTakeFirst())
          ? 'blocked fingerprint with this fingerprint already exists.' : null)],
      }],
      ['reason', { kind: 'char', required: false, allowBlank: true }],
    ]);
    if (v.errors) return res.status(400).json(v.errors);
    const obj = await db.insertInto('trustsafety_blockedfingerprint').values({
      fingerprint: v.values.fingerprint as string, reason: (v.values.reason as string | undefined) ?? '', blocked_by_id: req.user!.id, created_at: nowPg(),
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'fingerprint.block', { target: auditTarget('BlockedFingerprint', obj.id, fingerprintStr(obj.fingerprint)), reason: obj.reason });
    return res.status(201).json((await serializeFingerprints([obj]))[0]);
  },
}));

r.path('blocked-fingerprints/<int:pk>/', view({
  async DELETE(req, res) {
    await requireTrustSafety(req);
    const pk = pkParam(req.params.pk);
    const obj = pk === null ? undefined : await db.selectFrom('trustsafety_blockedfingerprint').selectAll().where('id', '=', pk).executeTakeFirst();
    if (!obj) throw notFoundFor('BlockedFingerprint');
    await logAdminAction(req, 'fingerprint.unblock', { target: auditTarget('BlockedFingerprint', obj.id, fingerprintStr(obj.fingerprint)) });
    await db.deleteFrom('trustsafety_blockedfingerprint').where('id', '=', obj.id).execute();
    return res.status(204).end();
  },
}));

r.path('blacklisted-locations/', view({
  async GET(req) {
    await requireTrustSafety(req);
    const rows = await db.selectFrom('trustsafety_blacklistedlocation').selectAll().orderBy('created_at', 'desc').execute();
    return serializeLocations(rows);
  },
  async POST(req, res) {
    await requireTrustSafety(req);
    const { data } = await parseRequest(req, res);
    const v = await runSerializer(data, [
      ['name', { kind: 'char', maxLength: 255 }],
      ['latitude', { kind: 'decimal', maxDigits: 9, decimalPlaces: 6 }],
      ['longitude', { kind: 'decimal', maxDigits: 9, decimalPlaces: 6 }],
      ['radius_km', { kind: 'decimal', required: false, maxDigits: 5, decimalPlaces: 2 }],
      ['reason', { kind: 'char', required: false, allowBlank: true }],
    ]);
    if (v.errors) return res.status(400).json(v.errors);
    const obj = await db.insertInto('trustsafety_blacklistedlocation').values({
      name: v.values.name as string, latitude: v.values.latitude as string, longitude: v.values.longitude as string,
      radius_km: (v.values.radius_km as string | undefined) ?? '0.2', reason: (v.values.reason as string | undefined) ?? '',
      created_by_id: req.user!.id, created_at: nowPg(),
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'location.blacklist', { target: auditTarget('BlacklistedLocation', obj.id, obj.name), reason: obj.reason });
    return res.status(201).json((await serializeLocations([obj]))[0]);
  },
}));

r.path('blacklisted-locations/<int:pk>/', view({
  async DELETE(req, res) {
    await requireTrustSafety(req);
    const pk = pkParam(req.params.pk);
    const obj = pk === null ? undefined : await db.selectFrom('trustsafety_blacklistedlocation').selectAll().where('id', '=', pk).executeTakeFirst();
    if (!obj) throw notFoundFor('BlacklistedLocation');
    await logAdminAction(req, 'location.unblacklist', { target: auditTarget('BlacklistedLocation', obj.id, obj.name) });
    await db.deleteFrom('trustsafety_blacklistedlocation').where('id', '=', obj.id).execute();
    return res.status(204).end();
  },
}));
