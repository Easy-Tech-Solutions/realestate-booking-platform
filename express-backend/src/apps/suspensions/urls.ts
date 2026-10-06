// suspensions — /api/suspensions/ (port of suspensions/views.py + urls.py).

import type { Response } from 'express';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import { hasAnyPermission, registerExecutor, submitOrExecute } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import { notifyAccountReinstated, notifyAccountSuspended } from '../../domain/notifications.js';
import { createSuspension, hasActiveSuspension, revokeSuspension } from '../../domain/suspensions.js';
import { isoformat } from '../../lib/datetime.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { limitOffset, pkValue, pyTypeName, qp, requestData } from '../users/request.js';
import {
  charField, choiceField, dateTimeField, FieldErr, isCurrentlyActive, pkRelatedField, serializeSuspension, tsMs, type Suspension,
} from './serializers.js';

export const DUAL_AUTH_SUSPENSION_LISTING_THRESHOLD = 3;
const TYPES = ['temporary', 'indefinite', 'permanent'];

/** _is_admin */
async function isAdmin(req: ApiRequest): Promise<boolean> {
  const u = req.user;
  if (!isSuperadminStaff(u)) return false;
  return (await requireDepartment(u, 'support')) || (await requireDepartment(u, 'trust_safety')) || (await hasAnyPermission(u, 'trust_safety.bans'));
}
const forbidden = (res: Response) => res.status(403).json({ detail: 'Admin access required.' });
const notFound = (res: Response) => res.status(404).json({ detail: 'Not found.' });

/** Second notify + save(update_fields=['user_notified']) done by the view/executor after create. */
async function notifyAgain(s: Suspension) {
  try {
    await notifyAccountSuspended(s as never);
    await db.updateTable('suspensions_suspension').set({ user_notified: true }).where('id', '=', s.id).execute();
    s.user_notified = true;
  } catch { /* swallowed */ }
}

/** @dual_auth.register_executor('user.suspend') */
registerExecutor('user.suspend', async (payload: Record<string, any>) => {
  const target = await db.selectFrom('users_user').selectAll().where('id', '=', pkValue(payload.user_id) ?? -1).executeTakeFirst();
  if (!target) throw new Error('User matching query does not exist.');
  const issuer = await db.selectFrom('users_user').selectAll().where('id', '=', pkValue(payload.issued_by_id) ?? -1).executeTakeFirst();
  if (!issuer) throw new Error('User matching query does not exist.');
  if (await hasActiveSuspension(target.id)) {
    throw new Error(`${target.username} already has an active suspension — refresh and check before re-approving.`);
  }
  let endsAt: string | null = null;
  if (payload.ends_at) endsAt = dateTimeField(payload.ends_at);
  let reportId: number | null = null;
  if (payload.related_report_id) {
    const rep = await db.selectFrom('reports_report').select('id').where('id', '=', pkValue(payload.related_report_id) ?? -1).executeTakeFirst();
    reportId = rep ? rep.id : null;
  }
  const s = await createSuspension({
    user_id: target.id, issued_by_id: issuer.id, suspension_type: payload.suspension_type, reason: payload.reason, ends_at: endsAt, related_report_id: reportId,
  });
  await notifyAgain(s);
  return { suspension_id: s.id, user: target.username };
});

const r = djangoRouter('api/suspensions/');

r.path('', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req))) return forbidden(res);
    let q = db.selectFrom('suspensions_suspension').selectAll();
    const st = qp(req, 'status'); const ty = qp(req, 'suspension_type'); const uid = qp(req, 'user_id');
    if (st) q = q.where('status', '=', st);
    if (ty) q = q.where('suspension_type', '=', ty);
    if (uid) {
      const v = pkValue(uid, 'id');
      q = v === null ? q.where(sql<boolean>`false`) : q.where('user_id', '=', v);
    }
    const { limit, offset } = limitOffset(req);
    const total = Number((await q.clearSelect().select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n);
    const rows = await q.orderBy('started_at', 'desc').limit(limit).offset(offset).execute();
    const results = [];
    for (const s of rows) results.push(await serializeSuspension(s));
    return { count: total, limit, offset, results };
  },
  async POST(req, res) {
    if (!(await isAdmin(req))) return forbidden(res);
    const { data } = await requestData(req, res);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] });
    }
    const d = data as Record<string, unknown>;
    const errors: Record<string, string[]> = {};
    const vals: Record<string, any> = {};
    const has = (k: string) => Object.prototype.hasOwnProperty.call(d, k);
    // Field order: user, suspension_type, reason, ends_at, related_report
    try {
      if (!has('user')) throw new FieldErr('This field is required.');
      const u = (await pkRelatedField(d.user, 'users_user'))!;
      if (u.is_staff || u.is_superuser) throw new FieldErr('Staff and superuser accounts cannot be suspended.');
      if (await hasActiveSuspension(u.id)) throw new FieldErr('This user already has an active suspension. Revoke it first.');
      vals.user = u;
    } catch (e) { if (e instanceof FieldErr) errors.user = [e.message]; else throw e; }
    try {
      if (!has('suspension_type')) throw new FieldErr('This field is required.');
      vals.suspension_type = choiceField(d.suspension_type, TYPES);
    } catch (e) { if (e instanceof FieldErr) errors.suspension_type = [e.message]; else throw e; }
    try {
      if (!has('reason')) throw new FieldErr('This field is required.');
      vals.reason = charField(d.reason);
    } catch (e) { if (e instanceof FieldErr) errors.reason = [e.message]; else throw e; }
    try {
      if (has('ends_at')) vals.ends_at = d.ends_at === null ? null : dateTimeField(d.ends_at);
    } catch (e) { if (e instanceof FieldErr) errors.ends_at = [e.message]; else throw e; }
    try {
      if (has('related_report')) vals.related_report = await pkRelatedField(d.related_report, 'reports_report', true);
    } catch (e) { if (e instanceof FieldErr) errors.related_report = [e.message]; else throw e; }
    if (Object.keys(errors).length) return res.status(400).json(errors);

    // validate(attrs)
    const endsAt: string | null = vals.ends_at ?? null;
    if (vals.suspension_type === 'temporary' && !endsAt) return res.status(400).json({ ends_at: ['A temporary suspension requires an end date.'] });
    if ((vals.suspension_type === 'indefinite' || vals.suspension_type === 'permanent') && endsAt) {
      return res.status(400).json({ ends_at: ['Indefinite and permanent suspensions must not have an end date.'] });
    }
    if (endsAt && tsMs(endsAt) <= Date.now()) return res.status(400).json({ ends_at: ['End date must be in the future.'] });

    const target = vals.user;
    const listingCount = Number((await db.selectFrom('listings_listing').select((eb) => eb.fn.countAll<string>().as('n'))
      .where('owner_id', '=', target.id).where('status', '=', 'published').where('deleted_at', 'is', null).executeTakeFirstOrThrow()).n);
    const report = vals.related_report ?? null;

    if (listingCount > DUAL_AUTH_SUSPENSION_LISTING_THRESHOLD) {
      const payload = {
        user_id: target.id, suspension_type: vals.suspension_type, reason: vals.reason,
        ends_at: endsAt ? isoformat(endsAt) : null, related_report_id: report ? report.id : null, issued_by_id: req.user!.id,
      };
      const [, approval] = await submitOrExecute('user.suspend', payload, req.user!, vals.reason, true);
      await logAdminAction(req, 'suspension.requested', {
        target: auditTarget('User', target.id, target.username), reason: vals.reason, metadata: { approval_id: approval!.id, listing_count: listingCount },
      });
      return res.status(202).json({
        pending_approval: true, approval_id: approval!.id,
        message: `${target.username} owns ${listingCount} published listings (above the ${DUAL_AUTH_SUSPENSION_LISTING_THRESHOLD} threshold) — this suspension requires a second admin to approve it before it takes effect.`,
      });
    }

    const s = await createSuspension({
      user_id: target.id, issued_by_id: req.user!.id, suspension_type: vals.suspension_type, reason: vals.reason,
      ends_at: endsAt, related_report_id: report ? report.id : null,
    });
    await logAdminAction(req, 'user.suspend', { target: auditTarget('User', target.id, target.username), reason: s.reason });
    await notifyAgain(s);
    return res.status(201).json(await serializeSuspension(s));
  },
}));

r.path('<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req))) return forbidden(res);
    const id = pkValue(String(req.params.pk));
    const s = id === null ? undefined : await db.selectFrom('suspensions_suspension').selectAll().where('id', '=', id).executeTakeFirst();
    if (!s) return notFound(res);
    return serializeSuspension(s);
  },
}));

r.path('<int:pk>/revoke/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await isAdmin(req))) return forbidden(res);
    const id = pkValue(String(req.params.pk));
    const s = id === null ? undefined : await db.selectFrom('suspensions_suspension').selectAll().where('id', '=', id).executeTakeFirst();
    if (!s) return notFound(res);
    if (!isCurrentlyActive(s as never)) return res.status(400).json({ detail: 'This suspension is not active and cannot be revoked.' });
    const { data } = await requestData(req, res);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return res.status(400).json({ non_field_errors: [`Invalid data. Expected a dictionary, but got ${pyTypeName(data)}.`] });
    }
    let reason = '';
    if (Object.prototype.hasOwnProperty.call(data, 'revocation_reason')) {
      try { reason = charField((data as Record<string, unknown>).revocation_reason, { allowBlank: true })!; } catch (e) {
        if (e instanceof FieldErr) return res.status(400).json({ revocation_reason: [e.message] });
        throw e;
      }
    }
    const updated = await revokeSuspension(s.id, req.user!.id, reason);
    const user = await db.selectFrom('users_user').select(['id', 'username']).where('id', '=', s.user_id).executeTakeFirstOrThrow();
    await logAdminAction(req, 'user.unsuspend', { target: auditTarget('User', user.id, user.username), reason });
    try { await notifyAccountReinstated(updated as never); } catch { /* swallowed */ }
    return serializeSuspension(updated);
  },
}));

r.path('user/<int:user_id>/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req))) return forbidden(res);
    const raw = String(req.params.user_id);
    const uid = pkValue(raw);
    const rows = uid === null ? [] : await db.selectFrom('suspensions_suspension').selectAll().where('user_id', '=', uid).orderBy('started_at', 'desc').execute();
    const suspensions = [];
    for (const s of rows) suspensions.push(await serializeSuspension(s));
    return {
      user_id: uid === null ? Number(raw) : uid,
      currently_suspended: uid === null ? false : await hasActiveSuspension(uid),
      total: rows.length,
      suspensions,
    };
  },
}));

r.path('stats/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await isAdmin(req))) return forbidden(res);
    const byStatus = Object.fromEntries((await sql<{ k: string; n: string }>`SELECT status AS k, count(id) AS n FROM suspensions_suspension GROUP BY status`.execute(db)).rows.map((x) => [x.k, Number(x.n)]));
    const byType = Object.fromEntries((await sql<{ k: string; n: string }>`SELECT suspension_type AS k, count(id) AS n FROM suspensions_suspension GROUP BY suspension_type`.execute(db)).rows.map((x) => [x.k, Number(x.n)]));
    const active = Number((await sql<{ n: string }>`SELECT count(*) AS n FROM suspensions_suspension WHERE status = 'active' AND (ends_at IS NULL OR ends_at > now())`.execute(db)).rows[0]!.n);
    const total = Number((await sql<{ n: string }>`SELECT count(*) AS n FROM suspensions_suspension`.execute(db)).rows[0]!.n);
    return {
      total, currently_active: active,
      by_status: { active: byStatus.active ?? 0, expired: byStatus.expired ?? 0, revoked: byStatus.revoked ?? 0 },
      by_type: { temporary: byType.temporary ?? 0, indefinite: byType.indefinite ?? 0, permanent: byType.permanent ?? 0 },
    };
  },
}));
