// superadmin — /api/superadmin/ (port of superadmin/urls.py, views.py,
// serializers.py, throttles.py and generic_admin/urls.py).

import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { sql } from 'kysely';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { pyStr } from '../../domain/notifications.js';
import { hasAnyPermission, isFullAdmin } from '../../domain/rbac.js';
import {
  auditTarget, BACKUP_CODE_COUNT, DEPARTMENT_SLUGS, getClientIp, isSuperadminStaff, logAdminAction, MFA_LOGIN_SALT, MFA_TOKEN_MAX_AGE,
  totpVerify, userDepartments, verifyCodeOrBackup,
} from '../../domain/superadmin.js';
import { createUser, emailIexact, mediaUrl, serializeAuthUser } from '../../domain/users.js';
import { logActivity } from '../../lib/activity.js';
import { drf } from '../../lib/datetime.js';
import { notFoundFor } from '../../lib/errors.js';
import { makePassword, makeUnusablePassword } from '../../lib/hashers.js';
import { accessForUser, accessFromRefresh, refreshForUser } from '../../lib/jwt.js';
import { anonRateThrottle } from '../../lib/throttle.js';
import { saveUpload } from '../../lib/upload.js';
import { apiView, AllowAny, IsAuthenticated, type ApiRequest, type User } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { sendMfaEmailCode, sendPasswordResetEmail, verifyMfaEmailCode } from '../authapp/utils.js';
import { dget, isFile, pkValue, pyBool, pyIn, pyIntParse, pyStrip, qp, requestData, strStrip, type UploadedFile } from '../users/request.js';
import { provisioningUri, qrPngBase64, randomBase32 } from '../users/utils.js';
import { validate, type FieldSpec } from '../../lib/fields.js';
import { genericDetail, genericListCreate, icontains } from './generic_admin.js';
import { BadSignature, SignatureExpired, TimestampSigner } from '../../lib/signing.js';

type Row = Record<string, any>;
const r = djangoRouter('api/superadmin/');
const err = (res: Response, status: number, body: Record<string, unknown>) => res.status(status).json(body);
const SUPERADMIN_REQUIRED = { error: 'Superadmin access required' };

// --- generic/ (include('superadmin.generic_admin.urls')) ------------------------------
r.path('generic/<str:model_key>/', apiView({ permissions: [IsAuthenticated], GET: genericListCreate, POST: genericListCreate }));
r.path('generic/<str:model_key>/<int:pk>/', apiView({ permissions: [IsAuthenticated], GET: genericDetail, PATCH: genericDetail, DELETE: genericDetail }));

// --- helpers --------------------------------------------------------------------------

const mfaDevice = (userId: number) => db.selectFrom('superadmin_mfadevice').selectAll().where('user_id', '=', userId).orderBy('id').executeTakeFirst();
const confirmedDevice = (userId: number) => db.selectFrom('superadmin_mfadevice').selectAll()
  .where('user_id', '=', userId).where('confirmed', '=', true).orderBy('id').executeTakeFirst();
const userTarget = (u: { id: number; username: string }) => auditTarget('User', u.id, u.username);

/** _mask_email */
function maskEmail(email: string): string {
  const i = email.indexOf('@');
  if (i < 0) return email;
  const local = [...email.slice(0, i)];
  const domain = email.slice(i + 1);
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible.join('')}${'*'.repeat(Math.max(local.length - visible.length, 3))}@${domain}`;
}

/** TimestampSigner.unsign(value) type behaviour for non-string request values (`sep in value`, then rsplit). */
function unsignToken(token: unknown): string {
  const signer = new TimestampSigner(MFA_LOGIN_SALT);
  if (typeof token === 'string') return signer.unsignWithAge(token, MFA_TOKEN_MAX_AGE);
  if (Array.isArray(token) || (token && typeof token === 'object')) {
    const has = Array.isArray(token) ? token.includes(':') : Object.prototype.hasOwnProperty.call(token, ':');
    if (!has) throw new BadSignature('No ":" found in value');
    throw new TypeError(`'${Array.isArray(token) ? 'list' : 'dict'}' object has no attribute 'rsplit'`);
  }
  throw new TypeError(`argument of type '${typeof token === 'number' ? (Number.isInteger(token) ? 'int' : 'float') : 'bool'}' is not iterable`);
}

/** _resolve_mfa_token */
async function resolveMfaToken(res: Response, token: unknown): Promise<User | null> {
  let userId: string;
  try {
    userId = unsignToken(token);
  } catch (e) {
    if (e instanceof SignatureExpired) { err(res, 401, { error: 'This session has expired. Please log in again.' }); return null; }
    if (e instanceof BadSignature) { err(res, 401, { error: 'Invalid session.' }); return null; }
    throw e;
  }
  const pk = pkValue(userId);
  const user = pk === null ? undefined : await db.selectFrom('users_user').selectAll().where('id', '=', pk).executeTakeFirst();
  if (!user) { err(res, 401, { error: 'Invalid session.' }); return null; }
  return user;
}

function setRefreshCookie(res: Response, refresh: string) {
  const c = config.refreshCookie;
  res.cookie(c.name, refresh, {
    httpOnly: true, secure: c.secure, sameSite: c.sameSite.toLowerCase() as 'lax' | 'strict' | 'none',
    domain: c.domain, maxAge: c.maxAgeSeconds * 1000, path: c.path,
  });
}

// --- me ----------------------------------------------------------------------------------

r.path('me/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const user = req.user!;
    if (!isSuperadminStaff(user)) return err(res, 403, SUPERADMIN_REQUIRED);
    const device = await mfaDevice(user.id);
    return {
      is_full_admin: isFullAdmin(user),
      departments: await userDepartments(user),
      all_departments: [...DEPARTMENT_SLUGS],
      mfa_enabled: !!(device && device.confirmed),
    };
  },
}));

// --- MFA enrollment ----------------------------------------------------------------------

r.path('mfa/setup/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = req.user!;
    if (!isSuperadminStaff(user)) return err(res, 403, SUPERADMIN_REQUIRED);
    const d = await mfaDevice(user.id);
    if (d && d.confirmed) return err(res, 400, { error: 'MFA is already enabled. Disable it first to re-enroll.' });
    const secret = randomBase32();
    // update_or_create(user=..., defaults={secret, confirmed: False, backup_codes: []})
    if (d) {
      await db.updateTable('superadmin_mfadevice').set({ secret, confirmed: false, backup_codes: JSON.stringify([]) }).where('id', '=', d.id).execute();
    } else {
      await db.insertInto('superadmin_mfadevice').values({
        user_id: user.id, secret, confirmed: false, backup_codes: JSON.stringify([]), created_at: new Date(), confirmed_at: null,
      }).execute();
    }
    const otpauth = provisioningUri(secret, user.email || user.username, `${config.siteName} Superadmin`);
    return { secret, otpauth_url: otpauth, qr_code_base64: await qrPngBase64(otpauth) };
  },
}));

r.path('mfa/confirm/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = req.user!;
    if (!isSuperadminStaff(user)) return err(res, 403, SUPERADMIN_REQUIRED);
    const { data } = await requestData(req, res);
    const code = strStrip(dget(data, 'code', ''));
    const d = await mfaDevice(user.id);
    if (!d) return err(res, 400, { error: 'Call mfa/setup/ first.' });
    if (d.confirmed) return err(res, 400, { error: 'MFA is already enabled.' });
    if (!totpVerify(d.secret, code)) return err(res, 400, { error: 'Invalid code.' });
    const plain = Array.from({ length: BACKUP_CODE_COUNT }, () => randomBytes(4).toString('hex'));
    const hashed: string[] = [];
    for (const c of plain) hashed.push(await makePassword(c));
    await db.updateTable('superadmin_mfadevice').set({ backup_codes: JSON.stringify(hashed), confirmed: true, confirmed_at: new Date() })
      .where('id', '=', d.id).execute();
    await logAdminAction(req, 'mfa.enable', { target: userTarget(user) });
    return { backup_codes: plain };
  },
}));

r.path('mfa/disable/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = req.user!;
    const d = await mfaDevice(user.id);
    if (!d || !d.confirmed) return err(res, 400, { error: 'MFA is not enabled.' });
    const { data } = await requestData(req, res);
    const code = strStrip(dget(data, 'code', ''));
    if (!(await verifyCodeOrBackup(d as never, code))) return err(res, 400, { error: 'Invalid code.' });
    await db.deleteFrom('superadmin_mfadevice').where('id', '=', d.id).execute();
    await logAdminAction(req, 'mfa.disable', { target: userTarget(user) });
    return { message: 'MFA disabled.' };
  },
}));

// --- MFA step-up during login -----------------------------------------------------------

r.path('mfa/verify-login/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('mfa_verify_login')],
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const mfaToken = dget(data, 'mfa_token', '');
    const code = strStrip(dget(data, 'code', ''));
    if (!pyBool(mfaToken) || !code) return err(res, 400, { error: 'mfa_token and code are required' });
    const user = await resolveMfaToken(res, mfaToken);
    if (!user) return;
    const device = await confirmedDevice(user.id);
    if (!device) return err(res, 400, { error: 'MFA is not enabled on this account.' });
    if (!(await verifyCodeOrBackup(device as never, code)) && !(await verifyMfaEmailCode(user, code))) {
      return err(res, 400, { error: 'Invalid code.' });
    }
    const { refresh, payload } = await refreshForUser(user.id);
    const access = accessFromRefresh(payload);
    logActivity(req, 'user_login', { user });
    setRefreshCookie(res, refresh);
    return res.json({ access, user: await serializeAuthUser(user) });
  },
}));

r.path('mfa/send-email-code/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('mfa_email_code')],
  async POST(req, res) {
    const { data } = await requestData(req, res);
    const mfaToken = dget(data, 'mfa_token', '');
    if (!pyBool(mfaToken)) return err(res, 400, { error: 'mfa_token is required' });
    const user = await resolveMfaToken(res, mfaToken);
    if (!user) return;
    if (!(await confirmedDevice(user.id))) return err(res, 400, { error: 'MFA is not enabled on this account.' });
    if (!user.email) return err(res, 400, { error: 'This account has no email on file.' });
    await sendMfaEmailCode(user);
    return { message: `A verification code was sent to ${maskEmail(user.email)}.` };
  },
}));

// --- audit log ----------------------------------------------------------------------------

/** django.utils.dateparse.parse_datetime / parse_date as DateTimeField.to_python uses them; invalid → ValidationError (500). */
function parseFilterDatetime(value: string): string {
  const dt = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:[.,](\d{1,6})\d*)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(value);
  const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const pad = (s: string | undefined, n = 2) => (s ?? '0').padStart(n, '0');
  if (dt) {
    const [, y, mo, da, h, mi, s, f, tz] = dt;
    const zone = !tz || tz === 'Z' ? '+00:00' : tz.length === 3 ? `${tz}:00` : tz.includes(':') ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`;
    return `${y}-${pad(mo)}-${pad(da)}T${pad(h)}:${pad(mi)}:${pad(s)}.${(f ?? '').padEnd(6, '0')}${zone}`;
  }
  if (d) return `${d[1]}-${pad(d[2])}-${pad(d[3])}T00:00:00+00:00`;
  throw new Error(`["“${value}” value has an invalid format. It must be in YYYY-MM-DD HH:MM[:ss[.uuuuuu]][TZ] format."]`);
}

async function serializeAuditLog(row: Row) {
  const actor = row.actor_id === null ? null : await db.selectFrom('users_user').select(['username', 'email']).where('id', '=', row.actor_id).executeTakeFirst();
  return {
    id: row.id, actor: row.actor_id, actor_username: actor ? actor.username : null, actor_email: actor ? actor.email : null,
    action: row.action, target_type: row.target_type, target_id: row.target_id, target_repr: row.target_repr, reason: row.reason,
    ip_address: row.ip_address, user_agent: row.user_agent, metadata: row.metadata, created_at: drf(row.created_at),
  };
}

r.path('audit-log/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(isFullAdmin(req.user) || (await hasAnyPermission(req.user, 'audit_log')))) return err(res, 403, { error: 'Full admin access required' });
    const action = qp(req, 'action');
    const targetType = qp(req, 'target_type');
    const actorId = qp(req, 'actor');
    const dateFrom = qp(req, 'date_from');
    const dateTo = qp(req, 'date_to');
    const base = () => {
      let q = db.selectFrom('superadmin_adminauditlog');
      if (action) q = q.where(icontains('action', action));
      if (targetType) q = q.where('target_type', '=', targetType);
      if (actorId) {
        const n = pyIntParse(actorId);
        if (n === null) throw new TypeError(`Field 'id' expected a number but got '${actorId}'.`);
        q = q.where('actor_id', '=', n);
      }
      if (dateFrom) q = q.where('created_at', '>=', parseFilterDatetime(dateFrom));
      if (dateTo) q = q.where('created_at', '<=', parseFilterDatetime(dateTo));
      return q;
    };
    let page = 1;
    const rawPage = qp(req, 'page');
    if (rawPage !== undefined) {
      const n = pyIntParse(rawPage);
      page = n === null ? 1 : Math.max(1, n);
    }
    const pageSize = 50;
    const start = (page - 1) * pageSize;
    const total = (await base().select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow()).n;
    const items = await base().selectAll().orderBy('created_at', 'desc').limit(pageSize).offset(start).execute();
    const results = [];
    for (const row of items) results.push(await serializeAuditLog(row));
    return { count: total, page, page_size: pageSize, results };
  },
}));

// --- impersonation --------------------------------------------------------------------------

r.path('impersonate/<int:user_id>/start/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const me = req.user!;
    if (!(isFullAdmin(me) || (await hasAnyPermission(me, 'users.impersonation')))) return err(res, 403, { error: 'Full admin access required' });
    const pk = pkValue(String(req.params.user_id));
    const target = pk === null ? undefined : await db.selectFrom('users_user').selectAll().where('id', '=', pk).executeTakeFirst();
    if (!target) return err(res, 404, { error: 'User not found' });
    if (target.id === me.id) return err(res, 400, { error: "You can't impersonate yourself." });
    if (isFullAdmin(target)) return err(res, 400, { error: 'Cannot impersonate another admin.' });
    const { data } = await requestData(req, res);
    const reason = strStrip(dget(data, 'reason', ''));
    if (!reason) return err(res, 400, { error: 'A reason is required to start an impersonation session.' });

    const ip = getClientIp(req);
    const session = await db.insertInto('superadmin_impersonationsession').values({
      admin_id: me.id, target_id: target.id, reason, started_at: new Date(), ended_at: null, ip_address: ip || null,
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'impersonation.start', { target: userTarget(target), reason, metadata: { session_id: session.id } });

    // AccessToken.for_user(target) + token['imp_by'] / token['imp_session'].
    const access = accessForUser(target.id, { imp_by: me.id, imp_session: session.id });
    return { access, user: await serializeAuthUser(target), session_id: session.id };
  },
}));

/** Microseconds since the epoch for a Postgres timestamptz text value. */
function pgMicros(v: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?([+-]\d{2})(?::?(\d{2}))?$/.exec(v.trim());
  if (!m) return BigInt(Date.parse(v)) * 1000n;
  const ms = Date.parse(`${m[1]}T${m[2]}${m[4]}:${m[5] ?? '00'}`);
  return BigInt(ms) * 1000n + BigInt((m[3] ?? '').padEnd(6, '0') || '0');
}

r.path('impersonate/stop/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const me = req.user!;
    const { data } = await requestData(req, res);
    const sessionId = dget(data, 'session_id', null);
    const pk = sessionId === null ? null : pkValue(sessionId);
    const session = pk === null ? undefined : await db.selectFrom('superadmin_impersonationsession').selectAll()
      .where('id', '=', pk).where('ended_at', 'is', null).orderBy('started_at', 'desc').executeTakeFirst();
    if (session && !([session.admin_id, session.target_id].includes(me.id) || isFullAdmin(me) || (await hasAnyPermission(me, 'users.impersonation')))) {
      return err(res, 403, { error: 'You are not authorized to end this impersonation session.' });
    }
    if (session) {
      const ended = new Date();
      await db.updateTable('superadmin_impersonationsession').set({ ended_at: ended }).where('id', '=', session.id).execute();
      const target = await db.selectFrom('users_user').select(['id', 'username']).where('id', '=', session.target_id).executeTakeFirstOrThrow();
      const micros = BigInt(ended.getTime()) * 1000n - pgMicros(session.started_at as unknown as string);
      await logAdminAction(req, 'impersonation.end', {
        target: userTarget(target), metadata: { session_id: session.id, duration_seconds: Number(micros) / 1e6 },
      });
    }
    return { message: 'Impersonation ended.' };
  },
}));

// --- staff onboarding & management -------------------------------------------------------------

async function requireStaffManagement(req: ApiRequest): Promise<boolean> {
  return isFullAdmin(req.user) || hasAnyPermission(req.user, 'users.staff_management');
}

/** _unique_username_from_email */
async function uniqueUsername(email: string): Promise<string> {
  const base = [...(email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '')].slice(0, 20).join('') || 'user';
  let candidate = base;
  while (await db.selectFrom('users_user').select('id').where('username', '=', candidate).executeTakeFirst()) {
    candidate = `${base}-${randomBytes(3).toString('hex')}`;
  }
  return candidate;
}

const fullName = (u: { first_name: string; last_name: string }) => pyStrip(`${u.first_name} ${u.last_name}`);

/** StaffProfile.__str__ */
function staffRepr(u: { first_name: string; last_name: string; username: string }, position: string): string {
  return `${fullName(u) || u.username} — ${position || 'no position set'}`;
}
const staffTarget = (s: Row, u: { first_name: string; last_name: string; username: string }) => auditTarget('StaffProfile', s.id, staffRepr(u, s.position));

/** DRF DateField.to_representation: str values pass through unchanged (unsaved in-memory instance). */
const dateRepr = (v: unknown): unknown => (v === null || v === undefined ? null : typeof v === 'string' ? v : v);

function serializeEducation(e: Row) {
  return {
    id: e.id, institution: e.institution, degree: e.degree, field_of_study: e.field_of_study,
    start_year: e.start_year, end_year: e.end_year, description: e.description, created_at: drf(e.created_at),
  };
}

const RECORD_TYPES = ['national_id', 'work_permit', 'contract', 'certification', 'other'];

function serializeLegal(l: Row) {
  return {
    id: l.id, record_type: l.record_type, title: l.title, issuing_authority: l.issuing_authority, document_number: l.document_number,
    issue_date: dateRepr(l.issue_date), expiry_date: dateRepr(l.expiry_date), document_url: l.document ? mediaUrl(l.document) : null,
    notes: l.notes, created_at: drf(l.created_at),
  };
}

const educationOf = (staffId: number) => db.selectFrom('superadmin_staffeducation').selectAll().where('staff_id', '=', staffId)
  .orderBy('end_year', 'desc').orderBy('start_year', 'desc').execute();
const legalOf = (staffId: number) => db.selectFrom('superadmin_stafflegalrecord').selectAll().where('staff_id', '=', staffId)
  .orderBy('created_at', 'desc').execute();

/** StaffProfileSerializer(staff).data — `hireDateRaw` set when the instance holds the raw request value (not reloaded). */
async function serializeStaff(s: Row, opts: { hireDate?: unknown } = {}) {
  const u = await db.selectFrom('users_user').selectAll().where('id', '=', s.user_id).executeTakeFirstOrThrow();
  const ob = s.onboarded_by_id === null ? null : await db.selectFrom('users_user').select('username').where('id', '=', s.onboarded_by_id).executeTakeFirst();
  return {
    id: s.id, user: s.user_id, full_name: fullName(u) || u.username, email: u.email, username: u.username,
    position: s.position, department: s.department,
    hire_date: 'hireDate' in opts ? (opts.hireDate === null ? null : pyStr(opts.hireDate)) : dateRepr(s.hire_date),
    phone_number: s.phone_number, bio: s.bio, is_active: s.is_active, onboarded_by_username: ob ? ob.username : null,
    education: (await educationOf(s.id)).map(serializeEducation),
    legal_records: (await legalOf(s.id)).map(serializeLegal),
    created_at: drf(s.created_at), updated_at: drf(s.updated_at),
  };
}

/**
 * Assigning a request value to a DateField and saving: DateField.get_prep_value → to_python
 * (date string → date; anything unparseable → ValidationError → 500).
 */
function hireDateForDb(v: unknown): string | null {
  if (v === null) return null;
  if (typeof v !== 'string') throw new TypeError(`fromisoformat: argument must be str`);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(v) ?? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (!m) throw new Error(`["“${v}” value has an invalid date format. It must be in YYYY-MM-DD format."]`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || mo < 1) throw new Error(`["“${v}” value has the correct format (YYYY-MM-DD) but it is an invalid date."]`);
  return `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

r.path('staff/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireStaffManagement(req))) return err(res, 403, { error: 'Permission Denied' });
    const rows = await db.selectFrom('superadmin_staffprofile').selectAll().orderBy('created_at', 'desc').execute();
    const out = [];
    for (const s of rows) out.push(await serializeStaff(s));
    return out;
  },
  async POST(req, res) {
    if (!(await requireStaffManagement(req))) return err(res, 403, { error: 'Permission Denied' });
    const { data } = await requestData(req, res);
    const email = strStrip(dget(data, 'email', '')).toLowerCase();
    if (!email) return err(res, 400, { error: 'Email is required.' });

    let user: User | undefined = await db.selectFrom('users_user').selectAll().where(emailIexact(email)).orderBy('id').executeTakeFirst();
    let accountCreated = false;
    if (!user) {
      user = await createUser({
        username: await uniqueUsername(email), email,
        first_name: strStrip(dget(data, 'first_name', '')), last_name: strStrip(dget(data, 'last_name', '')),
        is_active: true, email_verified: true, password: makeUnusablePassword(),
      });
      accountCreated = true;
    }
    if (await db.selectFrom('superadmin_staffprofile').select('id').where('user_id', '=', user.id).executeTakeFirst()) {
      return err(res, 400, { error: `${user.email} is already onboarded as staff.` });
    }
    if (!user.is_staff) {
      await db.updateTable('users_user').set({ is_staff: true }).where('id', '=', user.id).execute();
      user.is_staff = true;
    }
    const rawHire = dget(data, 'hire_date', null);
    const hire = pyBool(rawHire) ? rawHire : null;
    const now = new Date();
    const staff = await db.insertInto('superadmin_staffprofile').values({
      user_id: user.id,
      position: strStrip(dget(data, 'position', '')),
      department: strStrip(dget(data, 'department', '')),
      hire_date: hireDateForDb(hire),
      phone_number: strStrip(dget(data, 'phone_number', '')),
      bio: '', is_active: true, onboarded_by_id: req.user!.id, created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    if (accountCreated) await sendPasswordResetEmail(user);
    await logAdminAction(req, 'staff.onboard', {
      target: staffTarget(staff, user), reason: accountCreated ? 'new account' : 'linked existing account',
    });
    const out = await serializeStaff(staff, { hireDate: hire });
    return res.status(201).json({ ...out, account_created: accountCreated });
  },
}));

async function staffOr404(req: Request): Promise<Row> {
  const pk = pkValue(String(req.params.pk));
  const s = pk === null ? undefined : await db.selectFrom('superadmin_staffprofile').selectAll().where('id', '=', pk).executeTakeFirst();
  if (!s) throw notFoundFor('StaffProfile');
  return s;
}

async function staffUser(s: Row) {
  return db.selectFrom('users_user').select(['id', 'username', 'first_name', 'last_name']).where('id', '=', s.user_id).executeTakeFirstOrThrow();
}

r.path('staff/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireStaffManagement(req))) return err(res, 403, { error: 'Permission Denied' });
    return serializeStaff(await staffOr404(req));
  },
  async PATCH(req, res) {
    if (!(await requireStaffManagement(req))) return err(res, 403, { error: 'Permission Denied' });
    const staff = await staffOr404(req);
    const { data } = await requestData(req, res);
    for (const f of ['position', 'department', 'phone_number']) if (pyIn(data, f)) staff[f] = strStrip((data as Row)[f]);
    let hireOverride: { hireDate?: unknown } = {};
    if (pyIn(data, 'hire_date')) {
      const v = pyBool((data as Row).hire_date) ? (data as Row).hire_date : null;
      staff.hire_date = hireDateForDb(v);
      hireOverride = { hireDate: v };
    }
    if (pyIn(data, 'is_active')) staff.is_active = pyBool((data as Row).is_active);
    staff.updated_at = new Date();
    const { id, ...rest } = staff;
    const saved = await db.updateTable('superadmin_staffprofile').set(rest as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'staff.update', { target: staffTarget(saved, await staffUser(saved)) });
    return serializeStaff(saved, hireOverride);
  },
  async DELETE(req, res) {
    if (!(await requireStaffManagement(req))) return err(res, 403, { error: 'Permission Denied' });
    const staff = await staffOr404(req);
    await db.updateTable('superadmin_staffprofile').set({ is_active: false }).where('id', '=', staff.id).execute();
    await logAdminAction(req, 'staff.offboard', { target: staffTarget(staff, await staffUser(staff)) });
    return res.status(204).end();
  },
}));

const ownStaff = (req: ApiRequest) => db.selectFrom('superadmin_staffprofile').selectAll().where('user_id', '=', req.user!.id).orderBy('created_at', 'desc').executeTakeFirst();
const NO_PROFILE = { error: 'You do not have a staff profile.' };

r.path('staff/me/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    return serializeStaff(staff);
  },
  async PATCH(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    const { data } = await requestData(req, res);
    const s: Row = { ...staff };
    for (const f of ['bio', 'phone_number']) if (pyIn(data, f)) s[f] = strStrip((data as Row)[f]);
    s.updated_at = new Date();
    const { id, ...rest } = s;
    const saved = await db.updateTable('superadmin_staffprofile').set(rest as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    return serializeStaff(saved);
  },
}));

const isHtml = (req: Request) => !!req.is(['multipart/form-data', 'application/x-www-form-urlencoded']);
const UINT = { minValue: 0, maxValue: 2147483647 };

const EDUCATION_SPECS: FieldSpec[] = [
  { name: 'institution', kind: 'char', maxLength: 255 },
  { name: 'degree', kind: 'char', maxLength: 150, required: false, allowBlank: true },
  { name: 'field_of_study', kind: 'char', maxLength: 150, required: false, allowBlank: true },
  { name: 'start_year', kind: 'int', required: false, allowNull: true, ...UINT },
  { name: 'end_year', kind: 'int', required: false, allowNull: true, ...UINT },
  { name: 'description', kind: 'char', required: false, allowBlank: true },
];

const LEGAL_SPECS: FieldSpec[] = [
  { name: 'record_type', kind: 'choice', choices: RECORD_TYPES, required: false },
  { name: 'title', kind: 'char', maxLength: 255 },
  { name: 'issuing_authority', kind: 'char', maxLength: 255, required: false, allowBlank: true },
  { name: 'document_number', kind: 'char', maxLength: 100, required: false, allowBlank: true },
  { name: 'issue_date', kind: 'date', required: false, allowNull: true },
  { name: 'expiry_date', kind: 'date', required: false, allowNull: true },
  { name: 'document', kind: 'file', required: false, allowNull: true, maxLength: 100 },
  { name: 'notes', kind: 'char', required: false, allowBlank: true },
];

/** serializer.is_valid(raise_exception=True) */
async function validOrRaise(req: Request, res: Response, specs: FieldSpec[], partial: boolean): Promise<Record<string, unknown> | null> {
  const { data } = await requestData(req, res);
  const { errors, values } = await validate(data, specs, { partial, html: isHtml(req) });
  if (errors) { res.status(400).json(errors); return null; }
  return values;
}

r.path('staff/me/education/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    return (await educationOf(staff.id)).map(serializeEducation);
  },
  async POST(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    const v = await validOrRaise(req, res, EDUCATION_SPECS, false);
    if (!v) return;
    const row = await db.insertInto('superadmin_staffeducation').values({
      staff_id: staff.id, institution: v.institution as string, degree: (v.degree ?? '') as string, field_of_study: (v.field_of_study ?? '') as string,
      start_year: (v.start_year ?? null) as number | null, end_year: (v.end_year ?? null) as number | null, description: (v.description ?? '') as string,
      created_at: new Date(),
    }).returningAll().executeTakeFirstOrThrow();
    return res.status(201).json(serializeEducation(row));
  },
}));

r.path('staff/me/education/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    const pk = pkValue(String(req.params.pk));
    const entry = pk === null ? undefined : await db.selectFrom('superadmin_staffeducation').selectAll().where('id', '=', pk).where('staff_id', '=', staff.id).executeTakeFirst();
    if (!entry) throw notFoundFor('StaffEducation');
    const v = await validOrRaise(req, res, EDUCATION_SPECS, true);
    if (!v) return;
    const { id, ...rest } = { ...entry, ...v };
    const saved = await db.updateTable('superadmin_staffeducation').set(rest as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    return serializeEducation(saved);
  },
  async DELETE(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    const pk = pkValue(String(req.params.pk));
    const entry = pk === null ? undefined : await db.selectFrom('superadmin_staffeducation').select('id').where('id', '=', pk).where('staff_id', '=', staff.id).executeTakeFirst();
    if (!entry) throw notFoundFor('StaffEducation');
    await db.deleteFrom('superadmin_staffeducation').where('id', '=', entry.id).execute();
    return res.status(204).end();
  },
}));

async function storeDocument(v: Record<string, unknown>): Promise<void> {
  if (!('document' in v)) return;
  const f = v.document as UploadedFile | null;
  // FileField.get_prep_value(str(FieldFile)): an empty file stores '' (not NULL), even with null=True.
  v.document = f && isFile(f) ? await saveUpload('staff_legal_records/', f.name, f.buffer) : '';
}

r.path('staff/me/legal/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    return (await legalOf(staff.id)).map(serializeLegal);
  },
  async POST(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    const v = await validOrRaise(req, res, LEGAL_SPECS, false);
    if (!v) return;
    await storeDocument(v);
    const row = await db.insertInto('superadmin_stafflegalrecord').values({
      staff_id: staff.id, record_type: (v.record_type ?? 'other') as string, title: v.title as string,
      issuing_authority: (v.issuing_authority ?? '') as string, document_number: (v.document_number ?? '') as string,
      issue_date: (v.issue_date ?? null) as string | null, expiry_date: (v.expiry_date ?? null) as string | null,
      document: (v.document ?? '') as string, notes: (v.notes ?? '') as string, created_at: new Date(),
    }).returningAll().executeTakeFirstOrThrow();
    return res.status(201).json(serializeLegal(row));
  },
}));

r.path('staff/me/legal/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    const pk = pkValue(String(req.params.pk));
    const entry = pk === null ? undefined : await db.selectFrom('superadmin_stafflegalrecord').selectAll().where('id', '=', pk).where('staff_id', '=', staff.id).executeTakeFirst();
    if (!entry) throw notFoundFor('StaffLegalRecord');
    const v = await validOrRaise(req, res, LEGAL_SPECS, true);
    if (!v) return;
    await storeDocument(v);
    const { id, ...rest } = { ...entry, ...v };
    const saved = await db.updateTable('superadmin_stafflegalrecord').set(rest as never).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    return serializeLegal(saved);
  },
  async DELETE(req, res) {
    const staff = await ownStaff(req);
    if (!staff) return err(res, 404, NO_PROFILE);
    const pk = pkValue(String(req.params.pk));
    const entry = pk === null ? undefined : await db.selectFrom('superadmin_stafflegalrecord').select('id').where('id', '=', pk).where('staff_id', '=', staff.id).executeTakeFirst();
    if (!entry) throw notFoundFor('StaffLegalRecord');
    await db.deleteFrom('superadmin_stafflegalrecord').where('id', '=', entry.id).execute();
    return res.status(204).end();
  },
}));
