// rbac — /api/rbac/ (port of rbac/views.py + urls.py + serializers.py).

import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import {
  ACTION_LABELS, ACTIONS, approve, DualAuthPermissionError, DualAuthValueError, effectiveGrants, hasPermission, hasRole,
  reject, RESOURCE_TREE, type PendingApproval,
} from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, pyDatetimeStr } from '../../domain/superadmin.js';
import { drf, isoformat } from '../../lib/datetime.js';
import { notFoundFor } from '../../lib/errors.js';
import { apiView, IsAuthenticated, type ApiRequest, type User } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { FieldError, validate, type FieldSpec } from '../../lib/fields.js';
import { pyIntPk, pyStr } from '../../lib/py.js';

const MAX_BREAK_GLASS_HOURS = 8;
const DEFAULT_BREAK_GLASS_HOURS = 2;

const ACTION_KEY_RESOURCE: Record<string, [string, string]> = {
  'payment.refund': ['customer_support.vouchers', 'execute'],
  'user.suspend': ['trust_safety.bans', 'execute'],
};

const data = (req: Request): Record<string, unknown> => (req.body && typeof req.body === 'object' ? req.body : {});
const rawData = (req: Request): unknown => (req.body === undefined ? {} : req.body);
const forbid = (res: Response, error: string) => res.status(403).json({ error });
const SUPERADMIN_REQUIRED = 'Superadmin access required';
const RBAC_REQUIRED = 'RBAC Engine access required';

async function requireRbacEngine(req: ApiRequest, action = 'read'): Promise<boolean> {
  if (!isSuperadminStaff(req.user)) return false;
  return hasPermission(req.user, 'rbac_engine', action);
}

async function usernameOf(id: number | null | undefined): Promise<string | null> {
  if (id === null || id === undefined) return null;
  const u = await db.selectFrom('users_user').select('username').where('id', '=', id).executeTakeFirst();
  return u ? u.username : null;
}

/** Python float() on request data (TypeError/ValueError → null). */
function pyFloat(v: unknown): number | null {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/(\d)_(?=\d)/g, '$1');
  if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return Number(s);
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(s)) return NaN;
  return null;
}

// --- serializers -------------------------------------------------------------------

type RoleRow = { id: number; name: string; slug: string; description: string; is_preset: boolean; created_by_id: number | null; created_at: string; updated_at: string };

async function serializeRole(role: RoleRow) {
  // role.permissions.all(): no Meta.ordering → no ORDER BY (same plan order as Django).
  const perms = (await db.selectFrom('rbac_rolepermission').selectAll().where('role_id', '=', role.id).execute())
    .map((p) => ({ id: p.id, resource: p.resource, action: p.action }));
  const count = await db.selectFrom('rbac_userroleassignment').select(sql<number>`count(*)::int`.as('n')).where('role_id', '=', role.id).executeTakeFirstOrThrow();
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description,
    is_preset: role.is_preset,
    created_by: role.created_by_id,
    created_by_username: await usernameOf(role.created_by_id),
    permissions: perms,
    assignee_count: count.n,
    created_at: drf(role.created_at),
    updated_at: drf(role.updated_at),
  };
}

async function serializeAssignment(a: { id: number; user_id: number; role_id: number; granted_by_id: number | null; granted_at: string }) {
  const role = await db.selectFrom('rbac_role').select(['name', 'slug']).where('id', '=', a.role_id).executeTakeFirstOrThrow();
  return {
    id: a.id,
    user: a.user_id,
    username: await usernameOf(a.user_id),
    role: a.role_id,
    role_name: role.name,
    role_slug: role.slug,
    granted_by: a.granted_by_id,
    granted_by_username: await usernameOf(a.granted_by_id),
    granted_at: drf(a.granted_at),
  };
}

type SessionRow = { id: number; user_id: number; reason: string; granted_at: string; expires_at: string; revoked_at: string | null; revoked_by_id: number | null };

function sessionActive(s: SessionRow): boolean {
  if (s.revoked_at !== null) return false;
  return Date.now() < Date.parse(isoformat(s.expires_at)!);
}

async function serializeSession(s: SessionRow) {
  return {
    id: s.id,
    user: s.user_id,
    username: await usernameOf(s.user_id),
    reason: s.reason,
    granted_at: drf(s.granted_at),
    expires_at: drf(s.expires_at),
    revoked_at: drf(s.revoked_at),
    revoked_by: s.revoked_by_id,
    revoked_by_username: await usernameOf(s.revoked_by_id),
    is_active: sessionActive(s),
  };
}

async function serializeApproval(a: PendingApproval) {
  return {
    id: a.id,
    action_key: a.action_key,
    payload: a.payload,
    request_reason: a.request_reason,
    requested_by: a.requested_by_id,
    requested_by_username: await usernameOf(a.requested_by_id),
    status: a.status,
    decided_by: a.decided_by_id,
    decided_by_username: await usernameOf(a.decided_by_id),
    decision_reason: a.decision_reason,
    decided_at: drf(a.decided_at as string | null),
    execution_result: a.execution_result,
    execution_error: a.execution_error,
    created_at: drf(a.created_at as string),
  };
}

const ROLE_FIELDS: FieldSpec[] = [
  { name: 'name', kind: 'char', required: true, maxLength: 100, unique: { table: 'rbac_role', column: 'name', message: 'role with this name already exists.' } },
  { name: 'slug', kind: 'slug', required: true, maxLength: 100, unique: { table: 'rbac_role', column: 'slug', message: 'role with this slug already exists.' } },
  { name: 'description', kind: 'char', required: false, allowBlank: true },
];

const ROLE_PERMISSION_FIELDS: FieldSpec[] = [
  {
    name: 'resource', kind: 'char', required: true, maxLength: 100,
    validate: (v) => {
      if (!RESOURCE_TREE.some(([p]) => p === v)) throw new FieldError(`"${v}" is not a known resource path.`);
      return v;
    },
  },
  {
    name: 'action', kind: 'char', required: true, maxLength: 20,
    validate: (v) => {
      if (!(ACTIONS as readonly string[]).includes(v as string)) throw new FieldError(`Action must be one of: ${ACTIONS.join(', ')}.`);
      return v;
    },
  },
];

const roleRepr = (r: { name: string }) => r.name;
const assignmentRepr = async (a: { user_id: number; role_id: number }) => {
  const u = await usernameOf(a.user_id);
  const r = await db.selectFrom('rbac_role').select('slug').where('id', '=', a.role_id).executeTakeFirstOrThrow();
  return `${u} — ${r.slug}`;
};
const sessionRepr = async (s: SessionRow | { user_id: number; expires_at: string | Date }) =>
  `${await usernameOf(s.user_id)} — break-glass until ${pyDatetimeStr(s.expires_at)}`;
const approvalRepr = async (a: PendingApproval) => `${a.action_key} requested by ${await usernameOf(a.requested_by_id)} (${a.status})`;

// --- routes ----------------------------------------------------------------------------

const r = djangoRouter('api/rbac/');

r.path('resource-tree/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!isSuperadminStaff(req.user)) return forbid(res, SUPERADMIN_REQUIRED);
    return {
      resources: RESOURCE_TREE.map(([path, label, wired, note]) => ({ path, label, wired, note })),
      actions: ACTIONS.map((a) => ({ value: a, label: ACTION_LABELS[a] })),
    };
  },
}));

r.path('my-permissions/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!isSuperadminStaff(req.user)) return forbid(res, SUPERADMIN_REQUIRED);
    const grants = (await effectiveGrants(req.user)).sort(([r1, a1], [r2, a2]) => (r1 < r2 ? -1 : r1 > r2 ? 1 : a1 < a2 ? -1 : a1 > a2 ? 1 : 0));
    return { grants: grants.map(([resource, action]) => ({ resource, action })) };
  },
}));

r.path('roles/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireRbacEngine(req, 'read'))) return forbid(res, RBAC_REQUIRED);
    const roles = await db.selectFrom('rbac_role').selectAll().orderBy('name').execute();
    const out = [];
    for (const role of roles) out.push(await serializeRole(role as RoleRow));
    return out;
  },
  async POST(req, res) {
    if (!(await requireRbacEngine(req, 'execute'))) return forbid(res, RBAC_REQUIRED);
    const { errors, values } = await validate(rawData(req), ROLE_FIELDS);
    if (errors) return res.status(400).json(errors);
    const now = new Date();
    const role = await db.insertInto('rbac_role').values({
      name: values.name as string, slug: values.slug as string, description: (values.description as string | undefined) ?? '',
      is_preset: false, created_by_id: req.user!.id, created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'rbac.role.create', { target: auditTarget('Role', role.id, roleRepr(role)), reason: role.description });
    return res.status(201).json(await serializeRole(role as RoleRow));
  },
}));

async function getRole(pk: string) {
  const role = await db.selectFrom('rbac_role').selectAll().where('id', '=', Number(pk)).executeTakeFirst();
  if (!role) throw notFoundFor('Role');
  return role as RoleRow;
}

r.path('roles/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async DELETE(req, res) {
    if (!(await requireRbacEngine(req, 'execute'))) return forbid(res, RBAC_REQUIRED);
    const role = await getRole(String(req.params.pk));
    if (role.is_preset) {
      return res.status(400).json({ error: `"${role.name}" is a preset role backing legacy department access — deleting it would silently break existing staff access. Edit its permissions instead.` });
    }
    await logAdminAction(req, 'rbac.role.delete', { target: auditTarget('Role', role.id, roleRepr(role)) });
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom('rbac_rolepermission').where('role_id', '=', role.id).execute();
      await trx.deleteFrom('rbac_userroleassignment').where('role_id', '=', role.id).execute();
      await trx.deleteFrom('rbac_role').where('id', '=', role.id).execute();
    });
    return res.status(204).end();
  },
  async PATCH(req, res) {
    if (!(await requireRbacEngine(req, 'execute'))) return forbid(res, RBAC_REQUIRED);
    const role = await getRole(String(req.params.pk));
    const { errors, values } = await validate(rawData(req), ROLE_FIELDS, { partial: true, instanceId: role.id });
    if (errors) return res.status(400).json(errors);
    const updated = await db.updateTable('rbac_role').set({ ...values, updated_at: new Date() }).where('id', '=', role.id)
      .returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'rbac.role.update', { target: auditTarget('Role', updated.id, roleRepr(updated)), reason: updated.description });
    return serializeRole(updated as RoleRow);
  },
}));

r.path('roles/<int:pk>/permissions/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireRbacEngine(req, 'execute'))) return forbid(res, RBAC_REQUIRED);
    const role = await getRole(String(req.params.pk));
    const { errors, values } = await validate(rawData(req), ROLE_PERMISSION_FIELDS);
    if (errors) return res.status(400).json(errors);
    const resource = values.resource as string; const action = values.action as string;
    let perm = await db.selectFrom('rbac_rolepermission').select(['id', 'resource', 'action'])
      .where('role_id', '=', role.id).where('resource', '=', resource).where('action', '=', action).executeTakeFirst();
    let created = false;
    if (!perm) {
      perm = await db.insertInto('rbac_rolepermission').values({ role_id: role.id, resource, action }).returning(['id', 'resource', 'action']).executeTakeFirstOrThrow();
      created = true;
    }
    await logAdminAction(req, 'rbac.role.grant', { target: auditTarget('Role', role.id, roleRepr(role)), reason: `${perm.resource}.${perm.action}` });
    return res.status(created ? 201 : 200).json(perm);
  },
}));

r.path('roles/<int:pk>/permissions/<int:perm_id>/', apiView({
  permissions: [IsAuthenticated],
  async DELETE(req, res) {
    if (!(await requireRbacEngine(req, 'execute'))) return forbid(res, RBAC_REQUIRED);
    const role = await getRole(String(req.params.pk));
    const perm = await db.selectFrom('rbac_rolepermission').selectAll()
      .where('id', '=', Number(req.params.perm_id)).where('role_id', '=', role.id).executeTakeFirst();
    if (!perm) throw notFoundFor('RolePermission');
    await logAdminAction(req, 'rbac.role.revoke_grant', { target: auditTarget('Role', role.id, roleRepr(role)), reason: `${perm.resource}.${perm.action}` });
    await db.deleteFrom('rbac_rolepermission').where('id', '=', perm.id).execute();
    return res.status(204).end();
  },
}));

r.path('user-roles/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireRbacEngine(req, 'read'))) return forbid(res, RBAC_REQUIRED);
    // Unordered queryset with select_related('user', 'role', 'granted_by'): issue the same
    // joins, the same (full-width) column list and no ORDER BY, so the planner picks the
    // same plan and Postgres returns rows in the same order as Django.
    const userId = req.query.user_id;
    const filter = typeof userId === 'string' && userId ? sql`WHERE a.user_id = ${pyIntPk(userId, 'id')}` : sql``;
    const { rows: raw } = await sql<{ __id: number; __user_id: number; __role_id: number; __granted_by_id: number | null; __granted_at: string }>`
      SELECT a.id AS __id, a.user_id AS __user_id, a.role_id AS __role_id, a.granted_by_id AS __granted_by_id, a.granted_at AS __granted_at,
             u.*, r.*, g.*
      FROM rbac_userroleassignment a
      INNER JOIN users_user u ON (a.user_id = u.id)
      INNER JOIN rbac_role r ON (a.role_id = r.id)
      LEFT OUTER JOIN users_user g ON (a.granted_by_id = g.id)
      ${filter}`.execute(db);
    const rows = raw.map((x) => ({ id: x.__id, user_id: x.__user_id, role_id: x.__role_id, granted_by_id: x.__granted_by_id, granted_at: x.__granted_at }));
    const out = [];
    for (const a of rows) out.push(await serializeAssignment(a));
    return out;
  },
  async POST(req, res) {
    if (!(await requireRbacEngine(req, 'execute'))) return forbid(res, RBAC_REQUIRED);
    const d = data(req);
    const userId = d.user; const roleId = d.role;
    const falsy = (v: unknown) => v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.keys(v).length);
    if (falsy(userId) || falsy(roleId)) return res.status(400).json({ error: 'user and role are required' });
    const target = await db.selectFrom('users_user').selectAll().where('id', '=', pyIntPk(userId)).executeTakeFirst();
    if (!target) throw notFoundFor('User');
    const role = await db.selectFrom('rbac_role').selectAll().where('id', '=', pyIntPk(roleId)).executeTakeFirst();
    if (!role) throw notFoundFor('Role');

    if (role.slug === 'superadmin') {
      return res.status(400).json({
        error:
          'The Superadmin role exists here for reference only — assigning it grants no ' +
          'extra access (real superadmin status bypasses the RBAC engine entirely and ' +
          'can only be granted via shell/Django admin access to the account itself).',
      });
    }

    let assignment = await db.selectFrom('rbac_userroleassignment').selectAll().where('user_id', '=', target.id).where('role_id', '=', role.id).executeTakeFirst();
    let created = false;
    if (!assignment) {
      assignment = await db.insertInto('rbac_userroleassignment').values({
        user_id: target.id, role_id: role.id, granted_by_id: req.user!.id, granted_at: new Date(),
      }).returningAll().executeTakeFirstOrThrow();
      created = true;
    }
    const upd: { is_staff?: boolean; role?: string } = {};
    if (!target.is_staff) upd.is_staff = true;
    if (role.slug === 'admin' && !['admin', 'superadmin'].includes(target.role)) upd.role = 'admin';
    if (Object.keys(upd).length) {
      // User.save(update_fields=...) writes only these columns.
      await db.updateTable('users_user').set(upd).where('id', '=', target.id).execute();
    }
    await logAdminAction(req, 'rbac.user_role.assign', {
      target: auditTarget('UserRoleAssignment', assignment.id, await assignmentRepr(assignment)),
      reason: `${target.username} -> ${role.slug}`,
    });
    return res.status(created ? 201 : 200).json(await serializeAssignment(assignment));
  },
}));

r.path('user-roles/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async DELETE(req, res) {
    if (!(await requireRbacEngine(req, 'execute'))) return forbid(res, RBAC_REQUIRED);
    const a = await db.selectFrom('rbac_userroleassignment').selectAll().where('id', '=', Number(req.params.pk)).executeTakeFirst();
    if (!a) throw notFoundFor('UserRoleAssignment');
    const target = await db.selectFrom('users_user').selectAll().where('id', '=', a.user_id).executeTakeFirstOrThrow();
    const role = await db.selectFrom('rbac_role').selectAll().where('id', '=', a.role_id).executeTakeFirstOrThrow();
    await logAdminAction(req, 'rbac.user_role.revoke', {
      target: auditTarget('UserRoleAssignment', a.id, `${target.username} — ${role.slug}`),
      reason: `${target.username} x ${role.slug}`,
    });
    if (role.slug === 'admin' && target.role === 'admin') {
      await db.updateTable('users_user').set({ role: 'user' }).where('id', '=', target.id).execute();
    }
    await db.deleteFrom('rbac_userroleassignment').where('id', '=', a.id).execute();
    return res.status(204).end();
  },
}));

// --- break-glass ---------------------------------------------------------------------

r.path('break-glass/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!isSuperadminStaff(req.user)) return forbid(res, SUPERADMIN_REQUIRED);
    let q = db.selectFrom('rbac_breakglasssession').selectAll();
    if (!(await hasPermission(req.user, 'rbac_engine', 'read'))) q = q.where('user_id', '=', req.user!.id);
    const rows = await q.orderBy('granted_at', 'desc').execute();
    const out = [];
    for (const s of rows) out.push(await serializeSession(s as SessionRow));
    return out;
  },
  async POST(req, res) {
    const user = req.user as User;
    if (!isSuperadminStaff(user)) return forbid(res, SUPERADMIN_REQUIRED);
    if (!((await hasRole(user, 'engineering')) || (await hasPermission(user, 'infrastructure.break_glass', 'execute')))) {
      return forbid(res, 'Break-glass access is limited to the engineering role.');
    }
    const d = data(req);
    const reason = pyStr('reason' in d ? d.reason : '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to request break-glass access.' });

    const active = await db.selectFrom('rbac_breakglasssession').select('id').where('user_id', '=', user.id)
      .where('revoked_at', 'is', null).where('expires_at', '>', sql<string>`now()`).executeTakeFirst();
    if (active) return res.status(400).json({ error: 'You already have an active break-glass session.' });

    const f = pyFloat('hours' in d ? d.hours : DEFAULT_BREAK_GLASS_HOURS);
    // min(nan, 8) is nan in Python → timedelta raises → 500.
    const hours = f === null ? DEFAULT_BREAK_GLASS_HOURS : Number.isNaN(f) ? NaN : Math.min(f, MAX_BREAK_GLASS_HOURS);
    if (!Number.isFinite(hours)) throw new Error('cannot convert float NaN to integer');
    const now = Date.now();
    const expires = new Date(now + Math.round(hours * 3600_000_000) / 1000);
    const session = await db.insertInto('rbac_breakglasssession').values({
      user_id: user.id, reason, granted_at: new Date(now), expires_at: expires, revoked_at: null, revoked_by_id: null,
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'rbac.break_glass.grant', {
      target: auditTarget('BreakGlassSession', session.id, await sessionRepr({ user_id: user.id, expires_at: expires })),
      reason,
      metadata: { expires_at: expires.toISOString().replace('Z', '+00:00') },
    });
    return res.status(201).json(await serializeSession(session as SessionRow));
  },
}));

r.path('break-glass/<int:pk>/revoke/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!isSuperadminStaff(req.user)) return forbid(res, SUPERADMIN_REQUIRED);
    const s = await db.selectFrom('rbac_breakglasssession').selectAll().where('id', '=', Number(req.params.pk)).executeTakeFirst();
    if (!s) throw notFoundFor('BreakGlassSession');
    if (s.user_id !== req.user!.id && !(await hasPermission(req.user, 'rbac_engine', 'execute'))) {
      return forbid(res, 'Only the session holder or an RBAC Engine admin can revoke this.');
    }
    if (!sessionActive(s as SessionRow)) return res.status(400).json({ error: 'This session is not active.' });
    const updated = await db.updateTable('rbac_breakglasssession').set({ revoked_at: new Date(), revoked_by_id: req.user!.id })
      .where('id', '=', s.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'rbac.break_glass.revoke', { target: auditTarget('BreakGlassSession', s.id, await sessionRepr(s as SessionRow)) });
    return serializeSession(updated as SessionRow);
  },
}));

// --- pending approvals (dual-authorization) ---------------------------------------------

async function canReview(user: User, a: PendingApproval): Promise<boolean> {
  const mapping = ACTION_KEY_RESOURCE[a.action_key];
  if (!mapping) return hasPermission(user, 'rbac_engine', 'execute');
  return hasPermission(user, mapping[0], mapping[1]);
}

r.path('approvals/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!isSuperadminStaff(req.user)) return forbid(res, SUPERADMIN_REQUIRED);
    let q = db.selectFrom('rbac_pendingapproval').selectAll();
    const raw = req.query.status;
    const statusFilter = raw === undefined ? 'pending' : typeof raw === 'string' ? raw : String((raw as unknown[]).at(-1));
    if (statusFilter && statusFilter !== 'all') q = q.where('status', '=', statusFilter);
    const rows = await q.orderBy('created_at', 'desc').execute();
    const out = [];
    for (const a of rows) {
      if ((await canReview(req.user!, a)) || a.requested_by_id === req.user!.id) out.push(await serializeApproval(a));
    }
    return out;
  },
}));

async function decide(req: ApiRequest, res: Response, kind: 'approve' | 'reject') {
  if (!isSuperadminStaff(req.user)) return forbid(res, SUPERADMIN_REQUIRED);
  const a = await db.selectFrom('rbac_pendingapproval').selectAll().where('id', '=', Number(req.params.pk)).executeTakeFirst();
  if (!a) throw notFoundFor('PendingApproval');
  if (!(await canReview(req.user!, a))) return forbid(res, 'You do not hold the permission required to review this request.');
  const reason = kind === 'reject' ? pyStr('reason' in data(req) ? data(req).reason : '').trim() : '';
  let out: PendingApproval;
  try {
    out = kind === 'approve' ? await approve(a, req.user!) : await reject(a, req.user!, reason);
  } catch (e) {
    if (e instanceof DualAuthPermissionError) return forbid(res, e.message);
    if (e instanceof DualAuthValueError) return res.status(400).json({ error: e.message });
    throw e;
  }
  await logAdminAction(req, `rbac.approval.${kind}`, {
    target: auditTarget('PendingApproval', out.id, await approvalRepr(out)),
    reason: kind === 'approve' ? out.request_reason : reason,
  });
  return serializeApproval(out);
}

r.path('approvals/<int:pk>/approve/', apiView({ permissions: [IsAuthenticated], POST: (req, res) => decide(req, res, 'approve') }));
r.path('approvals/<int:pk>/reject/', apiView({ permissions: [IsAuthenticated], POST: (req, res) => decide(req, res, 'reject') }));
