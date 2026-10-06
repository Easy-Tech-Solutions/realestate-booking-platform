// users — /api/users/ (port of users/urls.py: views.py, admin_views.py, mfa_views.py).

import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { db } from '../../db/index.js';
import {
  applyUserSaveRules, authenticate, blacklistUserTokens, createUser, emailIexact, hasUsablePassword,
  serializeAdminUser, serializePublicUser, serializeUser,
} from '../../domain/users.js';
import { hasPermission, isFullAdmin, registerExecutor, submitOrExecute } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, verifyCodeOrBackup } from '../../domain/superadmin.js';
import { notifyPhoneNumberChanged } from '../../domain/notifications.js';
import { logActivity } from '../../lib/activity.js';
import { isoformat } from '../../lib/datetime.js';
import { paginate } from '../../lib/drf.js';
import { NotFound } from '../../lib/errors.js';
import { makePassword } from '../../lib/hashers.js';
import { logger } from '../../lib/logger.js';
import { userRateThrottle } from '../../lib/throttle.js';
import { saveUpload } from '../../lib/upload.js';
import { isValidEmail } from '../../lib/validators.js';
import { AllowAny, apiView, IsAuthenticated, type ApiRequest, type User } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { serializeBooking } from '../../domain/bookings.js';
import { approvedFor as approvedHostApplication, mtnMomoNumberError } from '../../domain/hostapplications.js';
import { serializeFavorites, serializeListings } from '../../domain/listings.js';
import { collectAndDelete, deleteAccount, protectedRecordCounts } from './deletion.js';
import { validatePassword } from './password_validation.js';
import {
  dget, isFile, pkValue, pyBool, pyGetItem, pyIn, pyRepr, pySetDifference, pySlice, pyStr, qp, requestData, setKey, strip, strStrip,
} from './request.js';
import {
  generateOtp, provisioningUri, qrPngBase64, randomBase32, sendPhoneChangeEmailOtp, sendPhoneChangeSmsOtp, totpVerify,
} from './utils.js';
import { config } from '../../config.js';

const r = djangoRouter('api/users/');
const phoneChangeThrottle = () => [userRateThrottle('phone_change')];
const err = (res: Response, status: number, body: Record<string, unknown>) => res.status(status).json(body);
const userTarget = (u: User) => auditTarget('User', u.id, u.username);

async function loadUser(id: number | null): Promise<User | undefined> {
  if (id === null) return undefined;
  return db.selectFrom('users_user').selectAll().where('id', '=', id).executeTakeFirst();
}
/** <int:id> path value → pk (null when beyond bigint: no row can match). */
const pathId = (req: Request, key = 'id') => pkValue(String(req.params[key]));
/** get_object_or_404(User, pk=id) */
async function userOr404(req: Request): Promise<User> {
  const u = await loadUser(pathId(req));
  if (!u) throw new NotFound('No User matches the given query.');
  return u;
}

// ---- users_collection / admin_stats / user_detail ---------------------------------------------

r.path('', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!isFullAdmin(req.user)) return err(res, 403, { error: 'Permission denied' });
    const users = await db.selectFrom('users_user').selectAll().orderBy('id').execute();
    const out = [];
    for (const u of users) out.push(await serializePublicUser(u));
    return out;
  },
}));

r.path('admin/stats/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const u = req.user!;
    if (!['admin', 'superadmin'].includes(u.role) && !u.is_staff) return err(res, 403, { error: 'Permission denied' });
    const count = async (q: string) => Number((await sql<{ n: string }>`${sql.raw(q)}`.execute(db)).rows[0]!.n);
    const totalUsers = await count('SELECT count(*) AS n FROM users_user');
    const totalListings = await count("SELECT count(*) AS n FROM listings_listing WHERE status = 'published'");
    const totalBookings = await count('SELECT count(*) AS n FROM bookings_booking');
    const rev = (await sql<{ t: string | null }>`SELECT sum(amount) AS t FROM payments_payment WHERE status = 'completed'`.execute(db)).rows[0]!.t;
    const revenue = rev === null || Number(rev) === 0 ? 0 : Number(rev);

    const recentUsers = await db.selectFrom('users_user').selectAll().orderBy('date_joined', 'desc').limit(5).execute();
    const recentBookings = await sql<Record<string, any>>`
      SELECT b.*, u.username AS customer_username, u.email AS customer_email, l.title AS listing_title
      FROM bookings_booking b JOIN users_user u ON u.id = b.customer_id JOIN listings_listing l ON l.id = b.listing_id
      ORDER BY b.requested_at DESC LIMIT 10`.execute(db);
    const recentPayments = await sql<Record<string, any>>`
      SELECT p.*, u.username AS username, g.name AS gateway_name
      FROM payments_payment p JOIN users_user u ON u.id = p.user_id JOIN payments_paymentgateway g ON g.id = p.gateway_id
      ORDER BY p.created_at DESC LIMIT 10`.execute(db);
    const byStatus = await sql<{ status: string; count: string }>`SELECT status, count(id) AS count FROM bookings_booking GROUP BY status`.execute(db);

    const bookings = recentBookings.rows.map((b) => {
      if (b.total_price === null) throw new TypeError("float() argument must be a string or a real number, not 'NoneType'");
      return {
        id: b.id, customer_username: b.customer_username, customer_email: b.customer_email, listing_title: b.listing_title,
        start_date: b.start_date, end_date: b.end_date, total_price: Number(b.total_price), status: b.status,
        requested_at: isoformat(b.requested_at),
      };
    });
    const publicUsers = [];
    for (const x of recentUsers) publicUsers.push(await serializePublicUser(x));
    return {
      totals: { users: totalUsers, listings: totalListings, bookings: totalBookings, revenue },
      bookings_by_status: Object.fromEntries(byStatus.rows.map((x) => [x.status, Number(x.count)])),
      recent_users: publicUsers,
      recent_bookings: bookings,
      recent_payments: recentPayments.rows.map((p) => ({
        id: String(p.id), user: p.username ?? '', amount: Number(p.amount), status: p.status, gateway: p.gateway_name ?? '',
        created_at: isoformat(p.created_at),
      })),
    };
  },
}));

// ---- admin_views ----------------------------------------------------------------------------

/** _require_users(request, action, resource) */
async function requireUsers(req: ApiRequest, action: string, resource = 'users.profiles') {
  if (!isSuperadminStaff(req.user)) return false;
  return hasPermission(req.user, resource, action);
}
const denied = (res: Response, resource = 'users.profiles') => err(res, 403, { error: `${resource} access required` });

r.path('admin/list/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireUsers(req, 'read'))) return denied(res);
    let q = db.selectFrom('users_user').selectAll();
    const search = (qp(req, 'search') ?? '').trim();
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      q = q.where((eb) => eb.or([
        sql<boolean>`upper(username::text) LIKE upper(${like})`, sql<boolean>`upper(email::text) LIKE upper(${like})`,
        sql<boolean>`upper(first_name::text) LIKE upper(${like})`, sql<boolean>`upper(last_name::text) LIKE upper(${like})`,
      ].map((x) => eb(x, '=', true))));
    }
    const role = qp(req, 'role');
    if (role) q = q.where('role', '=', role);
    const active = qp(req, 'is_active');
    if (active === 'true' || active === 'false') q = q.where('is_active', '=', active === 'true');
    const staff = qp(req, 'is_staff');
    if (staff === 'true' || staff === 'false') q = q.where('is_staff', '=', staff === 'true');
    return paginate(req, { pageSize: 25, pageSizeQueryParam: 'page_size', maxPageSize: 100 },
      async () => Number((await q.clearSelect().select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow()).n),
      async (limit, offset) => {
        const rows = await q.orderBy('date_joined', 'desc').limit(limit).offset(offset).execute();
        const out = [];
        for (const u of rows) out.push(await serializeAdminUser(u));
        return out;
      });
  },
}));

r.path('admin/create/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireUsers(req, 'create'))) return denied(res);
    const { data } = await requestData(req, res);
    const username = strStrip(dget(data, 'username', ''));
    const email = strStrip(dget(data, 'email', '')).toLowerCase();
    let password = strStrip(pyBool(dget(data, 'password')) ? dget(data, 'password') : '');
    const first_name = strStrip(dget(data, 'first_name', ''));
    const last_name = strStrip(dget(data, 'last_name', ''));
    const role = dget(data, 'role', 'user');

    if (!username || !email) return err(res, 400, { error: 'username and email are required.' });
    if (role !== 'user' && role !== 'agent') {
      return err(res, 400, { error: "role must be 'user' or 'agent' — admin accounts must be provisioned via shell." });
    }
    if (await db.selectFrom('users_user').select('id').where('username', '=', username).executeTakeFirst()) {
      return err(res, 400, { error: 'That username is already taken.' });
    }
    if (!isValidEmail(email)) return err(res, 400, { error: 'Invalid email format.' });
    if (await db.selectFrom('users_user').select('id').where(emailIexact(email)).executeTakeFirst()) {
      return err(res, 400, { error: 'Another account already uses this email.' });
    }
    let generated: string | null = null;
    if (!password) {
      password = randomBytes(12).toString('base64url'); // secrets.token_urlsafe(12)
      generated = password;
    } else {
      const errors = validatePassword(password);
      if (errors.length) return err(res, 400, { error: errors.join(' ') });
    }
    const user = await createUser({
      username, email, first_name, last_name, role: role as string, email_verified: true, password: await makePassword(password),
    });
    await logAdminAction(req, 'user.create', { target: userTarget(user), reason: pyStr(dget(data, 'reason', '')), metadata: { role } });
    const resp: Record<string, unknown> = await serializeAdminUser(user);
    if (generated) resp.generated_password = generated;
    return res.status(201).json(resp);
  },
}));

r.path('admin/bulk/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const action = dget(data, 'action');
    const rawIds = dget(data, 'user_ids');
    const userIds = pyBool(rawIds) ? rawIds : [];
    const reason = strStrip(dget(data, 'reason', ''));
    const roleId = dget(data, 'role_id');

    const RES: Record<string, [string, string]> = {
      deactivate: ['users.profiles', 'delete'], reactivate: ['users.profiles', 'delete'], soft_delete: ['users.profiles', 'delete'],
      hard_delete: ['users.profiles', 'execute'], assign_role: ['rbac_engine', 'execute'], remove_role: ['rbac_engine', 'execute'],
    };
    if (action !== null && typeof action === 'object') throw new TypeError(`unhashable type: '${Array.isArray(action) ? 'list' : 'dict'}'`);
    if (typeof action !== 'string' || !(action in RES)) return err(res, 400, { error: `Unknown action "${pyStr(action)}".` });
    if (!Array.isArray(userIds) || !userIds.length) return err(res, 400, { error: 'user_ids (non-empty list) is required.' });
    if (userIds.length > 200) return err(res, 400, { error: 'Bulk actions are capped at 200 users per request.' });
    if ((action === 'assign_role' || action === 'remove_role') && !pyBool(roleId)) return err(res, 400, { error: 'role_id is required for this action.' });
    const [resource, permAction] = RES[action]!;
    if (!(await requireUsers(req, permAction, resource))) return denied(res, resource);

    const results: { succeeded: number[]; failed: { user_id: unknown; error: string }[] } = { succeeded: [], failed: [] };
    // pk__in drops None; int() rejects anything non-numeric (→ 500 ValueError).
    const pks = userIds.filter((v) => v !== null).map((v) => pkValue(v)).filter((v): v is number => v !== null);
    const keys = userIds.map(setKey);
    const original = new Map(userIds.map((v, i) => [keys[i]!, v]));
    // filter(pk__in=...) — no Meta.ordering on User, so heap order.
    const targets = pks.length ? await db.selectFrom('users_user').selectAll().where('id', 'in', pks).execute() : [];
    for (const missing of pySetDifference(keys, targets.map((t) => t.id))) {
      results.failed.push({ user_id: original.get(missing), error: 'Not found' });
    }
    for (const target of targets) {
      try {
        if (target.id === req.user!.id) throw new Error("Can't act on your own account in bulk.");
        if (action === 'deactivate') {
          if (isFullAdmin(target)) throw new Error('Cannot deactivate a superadmin account.');
          await db.updateTable('users_user').set({ is_active: false }).where('id', '=', target.id).execute();
        } else if (action === 'reactivate') {
          await db.updateTable('users_user').set({ is_active: true }).where('id', '=', target.id).execute();
        } else if (action === 'soft_delete') {
          if (isFullAdmin(target)) throw new Error('Cannot delete a superadmin account.');
          const [ok, error] = await deleteAccount(target);
          if (!ok) throw new Error(error!);
        } else if (action === 'hard_delete') {
          if (isFullAdmin(target)) throw new Error('Cannot delete a superadmin account.');
          if (Object.keys(await protectedRecordCounts(target.id)).length) {
            throw new Error(
              'Has related records (bookings/payments/listings/etc.) — bulk hard delete only covers accounts with zero history. ' +
              'Use the single-user hard delete action instead, which supports force=true plus second-admin dual-authorization.');
          }
          await db.transaction().execute((trx) => collectAndDelete('users_user', [target.id], trx));
        } else if (action === 'assign_role') {
          const rid = pkValue(roleId);
          const role = rid === null ? undefined : await db.selectFrom('rbac_role').selectAll().where('id', '=', rid).executeTakeFirst();
          if (!role) throw new Error('Role matching query does not exist.');
          if (role.slug === 'superadmin') {
            throw new Error('The Superadmin role is reference-only — it cannot be assigned. Real superadmin status is granted via shell access only.');
          }
          const hit = await db.selectFrom('rbac_userroleassignment').select('id').where('user_id', '=', target.id).where('role_id', '=', role.id).executeTakeFirst();
          if (!hit) {
            await db.insertInto('rbac_userroleassignment').values({ user_id: target.id, role_id: role.id, granted_by_id: req.user!.id, granted_at: new Date() }).execute();
          }
          const upd: Record<string, unknown> = {};
          if (!target.is_staff) upd.is_staff = true;
          if (role.slug === 'admin' && target.role !== 'admin' && target.role !== 'superadmin') upd.role = 'admin';
          if (Object.keys(upd).length) {
            const saved = applyUserSaveRules({ ...target, ...upd });
            const set: Record<string, unknown> = {};
            for (const k of Object.keys(upd)) set[k] = (saved as Record<string, unknown>)[k];
            await db.updateTable('users_user').set(set).where('id', '=', target.id).execute();
          }
        } else if (action === 'remove_role') {
          const rid = pkValue(roleId);
          if (rid !== null) await db.deleteFrom('rbac_userroleassignment').where('user_id', '=', target.id).where('role_id', '=', rid).execute();
          const role = rid === null ? undefined : await db.selectFrom('rbac_role').selectAll().where('id', '=', rid).executeTakeFirst();
          if (role && role.slug === 'admin' && target.role === 'admin') {
            await db.updateTable('users_user').set({ role: 'user' }).where('id', '=', target.id).execute();
          }
        }
        // Model.delete() sets the instance pk to None, so a hard-deleted user is reported as null.
        results.succeeded.push(action === 'hard_delete' ? (null as unknown as number) : target.id);
      } catch (e) {
        results.failed.push({ user_id: target.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await logAdminAction(req, `user.bulk_${action}`, {
      reason, metadata: { user_ids: userIds, succeeded: results.succeeded, failed: results.failed.map((f) => f.user_id) },
    });
    return results;
  },
}));

r.path('admin/<int:id>/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireUsers(req, 'read'))) return denied(res);
    return serializeAdminUser(await userOr404(req));
  },
}));

r.path('admin/<int:id>/update/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await requireUsers(req, 'update'))) return denied(res);
    const target = await userOr404(req);
    const { data } = await requestData(req, res);
    const changed: string[] = [];
    const t = { ...target } as User;
    if (pyIn(data, 'first_name')) {
      const v = pyGetItem(data, 'first_name');
      t.first_name = pySlice(pyStr(pyBool(v) ? v : ''), 150);
      changed.push('first_name');
    }
    if (pyIn(data, 'last_name')) {
      const v = pyGetItem(data, 'last_name');
      t.last_name = pySlice(pyStr(pyBool(v) ? v : ''), 150);
      changed.push('last_name');
    }
    let toAdmin = false; let awayFromAdmin = false;
    if (pyIn(data, 'role')) {
      const newRole = pyGetItem(data, 'role');
      if (target.role === 'superadmin' || newRole === 'superadmin') {
        return err(res, 400, { error: 'Superadmin role changes are not permitted from this dashboard — use the shell.' });
      }
      if (newRole !== 'user' && newRole !== 'agent' && newRole !== 'admin') {
        return err(res, 400, { error: "role must be 'user', 'agent', or 'admin'." });
      }
      if (target.role !== newRole) {
        if (newRole === 'admin' && !isFullAdmin(req.user)) return err(res, 403, { error: 'Only a superadmin can grant the Admin role.' });
        toAdmin = newRole === 'admin';
        awayFromAdmin = target.role === 'admin' && newRole !== 'admin';
        t.role = newRole;
        changed.push('role', 'is_staff');
      }
    }
    if (!changed.length) return err(res, 400, { error: 'No recognized fields to update.' });
    applyUserSaveRules(t);
    const set: Record<string, unknown> = {};
    for (const f of changed) set[f] = (t as Record<string, unknown>)[f];
    await db.updateTable('users_user').set(set).where('id', '=', t.id).execute();

    if (toAdmin || awayFromAdmin) {
      const adminRole = await db.selectFrom('rbac_role').select('id').where('slug', '=', 'admin').orderBy('name').executeTakeFirst();
      if (adminRole) {
        if (toAdmin) {
          const hit = await db.selectFrom('rbac_userroleassignment').select('id').where('user_id', '=', t.id).where('role_id', '=', adminRole.id).executeTakeFirst();
          if (!hit) await db.insertInto('rbac_userroleassignment').values({ user_id: t.id, role_id: adminRole.id, granted_by_id: req.user!.id, granted_at: new Date() }).execute();
        } else {
          await db.deleteFrom('rbac_userroleassignment').where('user_id', '=', t.id).where('role_id', '=', adminRole.id).execute();
        }
      }
    }
    await logAdminAction(req, 'user.update', { target: userTarget(t), reason: pyStr(dget(data, 'reason', '')), metadata: { fields: changed } });
    return serializeAdminUser(t);
  },
}));

r.path('admin/<int:id>/email/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await requireUsers(req, 'update', 'users.pii'))) return denied(res, 'users.pii');
    const target = await userOr404(req);
    const { data } = await requestData(req, res);
    const newEmail = strStrip(dget(data, 'email', '')).toLowerCase();
    if (!newEmail) return err(res, 400, { error: 'A valid email is required.' });
    if (!isValidEmail(newEmail)) return err(res, 400, { error: 'Invalid email format.' });
    if (await db.selectFrom('users_user').select('id').where(emailIexact(newEmail)).where('id', '!=', target.id).executeTakeFirst()) {
      return err(res, 400, { error: 'Another account already uses this email.' });
    }
    const oldEmail = target.email;
    const t = applyUserSaveRules({ ...target, email: newEmail, email_verified: false });
    await db.updateTable('users_user').set({ email: t.email, email_verified: false }).where('id', '=', t.id).execute();
    await logAdminAction(req, 'user.change_email', {
      target: userTarget(t), reason: pyStr(dget(data, 'reason', '')), metadata: { old_email: oldEmail, new_email: newEmail },
    });
    return serializeAdminUser(t);
  },
}));

r.path('admin/<int:id>/reset-password/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireUsers(req, 'update', 'users.pii'))) return denied(res, 'users.pii');
    const target = await userOr404(req);
    const { data } = await requestData(req, res);
    const raw = dget(data, 'password');
    const newPassword = pyStr(pyBool(raw) ? raw : '');
    if (!newPassword) return err(res, 400, { error: 'A new password is required.' });
    const errors = validatePassword(newPassword, target);
    if (errors.length) return err(res, 400, { error: errors.join(' ') });
    await db.updateTable('users_user').set({ password: await makePassword(newPassword) }).where('id', '=', target.id).execute();
    await blacklistUserTokens(target.id);
    await logAdminAction(req, 'user.reset_password', { target: userTarget(target), reason: pyStr(dget(data, 'reason', '')) });
    return { message: `${target.username}'s password has been reset. They've been logged out of all devices.` };
  },
}));

r.path('admin/<int:id>/toggle-active/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireUsers(req, 'delete'))) return denied(res);
    const target = await userOr404(req);
    if (target.id === req.user!.id) return err(res, 400, { error: "You can't deactivate your own account." });
    const { data } = await requestData(req, res);
    const raw = dget(data, 'is_active');
    if (raw === null) return err(res, 400, { error: 'is_active (true/false) is required.' });
    const desired = pyBool(raw);
    if (isFullAdmin(target) && !desired) return err(res, 400, { error: 'Cannot deactivate a superadmin account.' });
    await db.updateTable('users_user').set({ is_active: desired }).where('id', '=', target.id).execute();
    target.is_active = desired;
    await logAdminAction(req, desired ? 'user.activate' : 'user.deactivate', { target: userTarget(target), reason: pyStr(dget(data, 'reason', '')) });
    return serializeAdminUser(target);
  },
}));

r.path('admin/<int:id>/soft-delete/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireUsers(req, 'delete'))) return denied(res);
    const target = await userOr404(req);
    if (target.id === req.user!.id) return err(res, 400, { error: "You can't delete your own account from here." });
    if (isFullAdmin(target)) return err(res, 400, { error: 'Cannot delete a superadmin account.' });
    const { data } = await requestData(req, res);
    const reason = strStrip(dget(data, 'reason', ''));
    if (!reason) return err(res, 400, { error: 'A reason is required.' });
    const snapshot = target.username;
    const [ok, error] = await deleteAccount(target);
    if (!ok) return err(res, 400, { error });
    await logAdminAction(req, 'user.soft_delete', { target: userTarget(target), reason, metadata: { original_username: snapshot } });
    return { message: `"${snapshot}" has been deactivated and anonymized. Booking/payment history was preserved.` };
  },
}));

/** @dual_auth.register_executor('user.hard_delete') */
registerExecutor('user.hard_delete', async (payload: Record<string, unknown>) => {
  const id = pkValue(payload.user_id);
  const target = await loadUser(id);
  if (!target) throw new Error('User matching query does not exist.');
  await db.transaction().execute((trx) => collectAndDelete('users_user', [target.id], trx));
  return { deleted_user_id: payload.user_id, username: target.username };
});

r.path('admin/<int:id>/hard-delete/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireUsers(req, 'execute'))) return denied(res);
    const target = await userOr404(req);
    if (target.id === req.user!.id) return err(res, 400, { error: "You can't delete your own account." });
    if (isFullAdmin(target)) return err(res, 400, { error: 'Cannot delete a superadmin account.' });
    const { data } = await requestData(req, res);
    const reason = strStrip(dget(data, 'reason', ''));
    if (!reason) return err(res, 400, { error: 'A reason is required to permanently delete a user.' });
    const force = pyBool(dget(data, 'force'));
    const prot = await protectedRecordCounts(target.id);
    const hasProt = Object.keys(prot).length > 0;
    if (hasProt && !force) {
      return err(res, 400, {
        error: 'This user has related records that a hard delete would permanently destroy.',
        protected_records: prot,
        hint: 'Pass force=true to proceed anyway (a second admin will need to approve it), or use soft-delete instead to preserve history.',
      });
    }
    const payload = { user_id: target.id, reason, initiated_by_id: req.user!.id, force };
    const [result, approval] = await submitOrExecute('user.hard_delete', payload, req.user!, reason, hasProt);
    if (approval) {
      await logAdminAction(req, 'user.hard_delete.requested', {
        target: userTarget(target), reason, metadata: { protected_records: prot, forced: force, approval_id: approval.id },
      });
      return res.status(202).json({
        pending_approval: true, approval_id: approval.id,
        message: 'This user has related records; a second admin must approve before permanent deletion executes.',
      });
    }
    const out = result as { deleted_user_id: number; username: string };
    await logAdminAction(req, 'user.hard_delete', { target: null, reason, metadata: { deleted_user_id: out.deleted_user_id, deleted_username: out.username } });
    return { message: `User "${out.username}" permanently deleted.`, deleted_user_id: out.deleted_user_id };
  },
}));

r.path('<int:id>/', apiView({
  permissions: [AllowAny],
  async GET(req, res) {
    const u = await loadUser(pathId(req));
    if (!u) return err(res, 404, { error: 'not found' });
    return serializePublicUser(u);
  },
}));

// ---- me_dashboard / update_profile / delete_my_account --------------------------------------

r.path('me/dashboard/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const user = req.user!;
    const listings = await db.selectFrom('listings_listing').selectAll().where('owner_id', '=', user.id).where('deleted_at', 'is', null)
      .orderBy('created_at', 'desc').execute();
    const asCustomer = await db.selectFrom('bookings_booking').selectAll().where('customer_id', '=', user.id).orderBy('requested_at', 'desc').execute();
    const onMine = await db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id').selectAll('b')
      .where('l.owner_id', '=', user.id).orderBy('b.requested_at', 'desc').execute();
    const favorites = await db.selectFrom('listings_favorite').selectAll().where('user_id', '=', user.id).orderBy('created_at', 'desc').execute();
    const out = {
      user: await serializeUser(user),
      listings: [] as unknown[], bookings_as_customer: [] as unknown[], bookings_on_my_listings: [] as unknown[], favorites: [] as unknown[],
    };
    out.listings = await serializeListings(listings as never, req);
    for (const b of asCustomer) out.bookings_as_customer.push(await serializeBooking(b as never));
    for (const b of onMine) out.bookings_on_my_listings.push(await serializeBooking(b as never));
    out.favorites = await serializeFavorites(favorites as never, req);
    return out;
  },
}));

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

async function updateProfile(req: ApiRequest, res: Response) {
  const user = { ...req.user! };
  const { data, files } = await requestData(req, res);
  if (files.image && files.image.size > MAX_IMAGE_BYTES) {
    return err(res, 413, { error: 'Image file is too large. Maximum allowed is 10 MB.' });
  }
  const changed = ['first_name', 'last_name', 'email'].filter((f) => pyIn(data, f) && pyGetItem(data, f) !== '');
  if (changed.length) {
    for (const f of changed) {
      const v = pyGetItem(data, f);
      if (v === null) throw new TypeError(`null value in column "${f}" violates not-null constraint`);
      if (f === 'email' && typeof v !== 'string') {
        if (pyBool(v)) throw new TypeError(`'${typeof v}' object has no attribute 'strip'`);
      }
      (user as Record<string, unknown>)[f] = isFile(v) ? v.name : pyStr(v);
    }
    applyUserSaveRules(user);
    const set: Record<string, unknown> = {};
    for (const f of changed) set[f] = (user as Record<string, unknown>)[f];
    await db.updateTable('users_user').set(set).where('id', '=', user.id).execute();
  }
  if (pyIn(data, 'role')) {
    const role = pyGetItem(data, 'role');
    if ((role === 'user' || role === 'agent') && user.role !== 'admin' && user.role !== 'superadmin' && user.role !== role) {
      user.role = role;
      await db.updateTable('users_user').set({ role }).where('id', '=', user.id).execute();
    }
  }
  let profile = await db.selectFrom('users_profile').selectAll().where('user_id', '=', user.id).executeTakeFirst();
  if (!profile) {
    profile = await db.insertInto('users_profile').values({ user_id: user.id, bio: '', is_superhost: false, phone_number: '', image: '' })
      .returningAll().executeTakeFirstOrThrow();
  }
  let profileChanged = false;
  if (pyIn(data, 'bio')) {
    const v = pyGetItem(data, 'bio');
    if (v === null) throw new TypeError('null value in column "bio" violates not-null constraint');
    profile.bio = isFile(v) ? v.name : pyStr(v);
    profileChanged = true;
  }
  if (files.image) {
    profile.image = await saveUpload('uploads/', files.image.name, files.image.buffer);
    profileChanged = true;
  }
  if (profileChanged) {
    await db.updateTable('users_profile').set({ bio: profile.bio, image: profile.image }).where('id', '=', profile.id).execute();
  }
  const fresh = await db.selectFrom('users_user').selectAll().where('id', '=', user.id).executeTakeFirstOrThrow();
  return serializeUser(fresh);
}
r.path('me/profile/', apiView({ permissions: [IsAuthenticated], PUT: updateProfile, PATCH: updateProfile }));

r.path('me/delete/', apiView({
  permissions: [IsAuthenticated],
  async DELETE(req, res) {
    const userId = req.user!.id;
    const [ok, error] = await deleteAccount({ ...req.user! });
    if (!ok) return err(res, 400, { detail: error });
    logActivity(req, 'account_deletion_initiated', { resource_type: 'user', resource_id: userId });
    res.status(204).end();
  },
}));

// ---- phone / MoMo change (2-step OTP) --------------------------------------------------------

const OTP_VALID_MINUTES = 10;

async function checkPasswordStep(user: User, password: string, res: Response): Promise<boolean> {
  if (!hasUsablePassword(user)) return true;
  if (!password) { err(res, 400, { error: 'Current password is required.', code: 'password_required' }); return false; }
  if (!(await authenticate(user.username, password))) { err(res, 400, { error: 'Incorrect password.' }); return false; }
  return true;
}

type ChangeTable = 'users_phonechangerequest' | 'users_momochangerequest';

async function upsertChangeRequest(table: ChangeTable, userId: number, fields: Record<string, unknown>) {
  const otp = generateOtp();
  const expiry = new Date(Date.now() + OTP_VALID_MINUTES * 60_000);
  const values = {
    ...fields, password_verified: true, email_otp: otp, email_otp_expiry: expiry, email_otp_verified: false,
    sms_otp: otp, sms_otp_expiry: expiry, sms_otp_verified: false,
  };
  const existing = await db.selectFrom(table).select('id').where('user_id', '=', userId).executeTakeFirst();
  if (existing) await db.updateTable(table).set(values as never).where('id', '=', existing.id).execute();
  else await db.insertInto(table).values({ ...values, user_id: userId, created_at: new Date() } as never).execute();
  return otp;
}

r.path('phone-change/initiate/', apiView({
  permissions: [IsAuthenticated],
  throttles: phoneChangeThrottle(),
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const password = strip(dget(data, 'password', ''));
    const newPhone = strip(dget(data, 'new_phone_number', ''));
    const network = strip(dget(data, 'network_provider', '')).toLowerCase();
    if (!newPhone || !network) return err(res, 400, { error: 'new_phone_number and network_provider are required.' });
    if (network !== 'mtn' && network !== 'orange') return err(res, 400, { error: 'network_provider must be "mtn" or "orange".' });
    const user = req.user!;
    if (!(await checkPasswordStep(user, password, res))) return;
    const profile = await db.selectFrom('users_profile').select('phone_number').where('user_id', '=', user.id).executeTakeFirst();
    if (profile && profile.phone_number === newPhone) return err(res, 400, { error: 'That number is already linked to your account.' });
    const otp = await upsertChangeRequest('users_phonechangerequest', user.id, { new_phone_number: newPhone, network_provider: network });
    try {
      await sendPhoneChangeEmailOtp(user, otp, 'phone number');
    } catch (e) {
      logger.error({ err: e }, 'initiate_phone_change: failed to send email OTP');
      return err(res, 503, { error: 'Could not send the verification code. Please try again in a moment.' });
    }
    sendPhoneChangeSmsOtp(newPhone, otp, network, 'phone number');
    return { message: `A verification code has been sent to your email and to ${newPhone}. It expires in ${OTP_VALID_MINUTES} minutes.` };
  },
}));

async function loadChangeRequest(table: ChangeTable, userId: number) {
  return db.selectFrom(table).selectAll().where('user_id', '=', userId).executeTakeFirst() as Promise<Record<string, any> | undefined>;
}
const expired = (row: Record<string, any>) => Date.now() > Date.parse(isoformat(row.email_otp_expiry)!);

r.path('phone-change/verify/', apiView({
  permissions: [IsAuthenticated],
  throttles: phoneChangeThrottle(),
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const otp = strip(dget(data, 'otp', ''));
    if (!otp) return err(res, 400, { error: 'otp is required.' });
    const user = req.user!;
    const cr = await loadChangeRequest('users_phonechangerequest', user.id);
    if (!cr) return err(res, 400, { error: 'No pending phone change request. Please start from Step 1.' });
    if (expired(cr)) {
      await db.deleteFrom('users_phonechangerequest').where('id', '=', cr.id).execute();
      return err(res, 400, { error: 'Verification code has expired. Please start over.' });
    }
    if (cr.email_otp !== otp) return err(res, 400, { error: 'Invalid verification code.' });
    let profile = await db.selectFrom('users_profile').selectAll().where('user_id', '=', user.id).executeTakeFirst();
    if (!profile) {
      profile = await db.insertInto('users_profile').values({ user_id: user.id, bio: '', is_superhost: false, phone_number: '', image: '' })
        .returningAll().executeTakeFirstOrThrow();
    }
    const oldNumber = profile.phone_number;
    await db.updateTable('users_profile').set({ phone_number: cr.new_phone_number }).where('id', '=', profile.id).execute();
    await db.deleteFrom('users_phonechangerequest').where('id', '=', cr.id).execute();
    try {
      await notifyPhoneNumberChanged(user, oldNumber, cr.new_phone_number, cr.network_provider);
    } catch { /* never block the response */ }
    return { message: `Your phone number has been updated to ${cr.new_phone_number}.` };
  },
}));

r.path('phone-change/cancel/', apiView({
  permissions: [IsAuthenticated],
  async DELETE(req) {
    const r0 = await db.deleteFrom('users_phonechangerequest').where('user_id', '=', req.user!.id).executeTakeFirst();
    return Number(r0.numDeletedRows)
      ? { message: 'Phone change request cancelled.' }
      : { message: 'No pending phone change request found.' };
  },
}));

r.path('momo-change/initiate/', apiView({
  permissions: [IsAuthenticated],
  throttles: phoneChangeThrottle(),
  async POST(req, res) {
    const user = req.user!;
    const app = await approvedHostApplication(user.id);
    if (!app) return err(res, 403, { error: 'Only approved hosts can change their payout number.' });
    const { data } = await requestData(req, res);
    const password = strip(dget(data, 'password', ''));
    const newNumber = strip(dget(data, 'new_momo_number', ''));
    if (!newNumber) return err(res, 400, { error: 'new_momo_number is required.' });
    const bad = mtnMomoNumberError(newNumber);
    if (bad) return err(res, 400, { error: bad });
    if (!(await checkPasswordStep(user, password, res))) return;
    if (app.momo_number === newNumber) return err(res, 400, { error: 'That is already your payout number.' });
    const otp = await upsertChangeRequest('users_momochangerequest', user.id, { new_momo_number: newNumber, network_provider: 'mtn' });
    try {
      await sendPhoneChangeEmailOtp(user, otp, 'Mobile Money number');
    } catch (e) {
      logger.error({ err: e }, 'initiate_momo_change: failed to send email OTP');
      return err(res, 503, { error: 'Could not send the verification code. Please try again in a moment.' });
    }
    sendPhoneChangeSmsOtp(newNumber, otp, 'mtn', 'Mobile Money number');
    return { message: `A verification code has been sent to your email and to ${newNumber}. It expires in ${OTP_VALID_MINUTES} minutes.` };
  },
}));

r.path('momo-change/verify/', apiView({
  permissions: [IsAuthenticated],
  throttles: phoneChangeThrottle(),
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const otp = strip(dget(data, 'otp', ''));
    if (!otp) return err(res, 400, { error: 'otp is required.' });
    const user = req.user!;
    const cr = await loadChangeRequest('users_momochangerequest', user.id);
    if (!cr) return err(res, 400, { error: 'No pending MoMo number change request. Please start from Step 1.' });
    if (expired(cr)) {
      await db.deleteFrom('users_momochangerequest').where('id', '=', cr.id).execute();
      return err(res, 400, { error: 'Verification code has expired. Please start over.' });
    }
    if (cr.email_otp !== otp) return err(res, 400, { error: 'Invalid verification code.' });
    const app = await approvedHostApplication(user.id);
    if (!app) {
      await db.deleteFrom('users_momochangerequest').where('id', '=', cr.id).execute();
      return err(res, 403, { error: 'Only approved hosts can change their payout number.' });
    }
    const oldNumber = app.momo_number;
    await db.updateTable('hostapplications_hostapplication')
      .set({ momo_number: cr.new_momo_number, momo_network: cr.network_provider, updated_at: new Date() }).where('id', '=', app.id).execute();
    await db.deleteFrom('users_momochangerequest').where('id', '=', cr.id).execute();
    try {
      await notifyPhoneNumberChanged(user, oldNumber, cr.new_momo_number, cr.network_provider);
    } catch { /* never block the response */ }
    return { message: `Your Mobile Money payout number has been updated to ${cr.new_momo_number}.` };
  },
}));

r.path('momo-change/cancel/', apiView({
  permissions: [IsAuthenticated],
  async DELETE(req) {
    const r0 = await db.deleteFrom('users_momochangerequest').where('user_id', '=', req.user!.id).executeTakeFirst();
    return Number(r0.numDeletedRows)
      ? { message: 'MoMo change request cancelled.' }
      : { message: 'No pending MoMo change request found.' };
  },
}));

// ---- mfa_views ---------------------------------------------------------------------------------

const mfaDevice = (userId: number) => db.selectFrom('superadmin_mfadevice').selectAll().where('user_id', '=', userId).orderBy('id').executeTakeFirst();

r.path('mfa/status/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const d = await mfaDevice(req.user!.id);
    return { mfa_enabled: !!(d && d.confirmed) };
  },
}));

r.path('mfa/setup/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = req.user!;
    const d = await mfaDevice(user.id);
    if (d && d.confirmed) return err(res, 400, { error: 'MFA is already enabled. Disable it first to re-enroll.' });
    const secret = randomBase32();
    if (d) {
      await db.updateTable('superadmin_mfadevice').set({ secret, confirmed: false, backup_codes: JSON.stringify([]) }).where('id', '=', d.id).execute();
    } else {
      await db.insertInto('superadmin_mfadevice').values({
        user_id: user.id, secret, confirmed: false, backup_codes: JSON.stringify([]), created_at: new Date(), confirmed_at: null,
      }).execute();
    }
    const otpauth = provisioningUri(secret, user.email || user.username, config.siteName);
    return { secret, otpauth_url: otpauth, qr_code_base64: await qrPngBase64(otpauth) };
  },
}));

r.path('mfa/confirm/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const code = strStrip(dget(data, 'code', ''));
    const d = await mfaDevice(req.user!.id);
    if (!d) return err(res, 400, { error: 'Call mfa/setup/ first.' });
    if (d.confirmed) return err(res, 400, { error: 'MFA is already enabled.' });
    if (!totpVerify(d.secret, code, 1)) return err(res, 400, { error: 'Invalid code.' });
    const plain = Array.from({ length: 8 }, () => randomBytes(4).toString('hex'));
    const hashed = [];
    for (const c of plain) hashed.push(await makePassword(c));
    await db.updateTable('superadmin_mfadevice').set({ backup_codes: JSON.stringify(hashed), confirmed: true, confirmed_at: new Date() })
      .where('id', '=', d.id).execute();
    logActivity(req, 'mfa_enabled');
    return { backup_codes: plain };
  },
}));

r.path('mfa/disable/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const d = await mfaDevice(req.user!.id);
    if (!d || !d.confirmed) return err(res, 400, { error: 'MFA is not enabled.' });
    const { data } = await requestData(req, res);
    const code = strStrip(dget(data, 'code', ''));
    if (!(await verifyCodeOrBackup(d as never, code))) return err(res, 400, { error: 'Invalid code.' });
    await db.deleteFrom('superadmin_mfadevice').where('id', '=', d.id).execute();
    logActivity(req, 'mfa_disabled');
    return { message: 'MFA disabled.' };
  },
}));

void pyRepr;
