// superadmin — the pieces other apps import (port of superadmin/permissions.py,
// superadmin/constants.py and the AdminAuditLog writer). superadmin's own
// views/routes live in src/apps/superadmin/ (ported separately).
//
//   import { isSuperadminStaff, requireDepartment, logAdminAction, auditTarget } from '../../domain/superadmin.js';
//   await logAdminAction(req, 'listing.remove', { target: auditTarget('Listing', l.id, l.title), reason, metadata: { foo: 1 } });

import type { Request } from 'express';
import type { Transaction } from 'kysely';
import { db, type DB } from '../db/index.js';
import { createGuardrails, generateSync, verifySync } from 'otplib';
import { remoteAddr } from '../lib/clientIp.js';
import { checkPassword } from '../lib/hashers.js';
import { isoformat } from '../lib/datetime.js';
import type { ApiRequest, Permission } from '../lib/view.js';
import { hasRole, isFullAdmin, type RbacUser } from './rbac.js';

type Executor = typeof db | Transaction<DB>;

export { isFullAdmin } from './rbac.js';

// --- superadmin/constants.py ------------------------------------------------------

export const DEPARTMENTS: [string, string][] = [
  ['trust_safety', 'Trust & Safety'],
  ['inventory', 'Inventory & Listings'],
  ['support', 'Dispute Resolution & Support'],
  ['finance', 'Finance & Legal'],
  ['engineering', 'Platform & Engineering'],
];
export const DEPARTMENT_SLUGS = DEPARTMENTS.map(([slug]) => slug);

// --- superadmin/permissions.py ----------------------------------------------------

/** get_client_ip: first X-Forwarded-For entry, else REMOTE_ADDR (may be '' → stored as NULL). */
export function getClientIp(req: Request): string {
  const h = req.headers['x-forwarded-for'];
  const forwarded = Array.isArray(h) ? h.join(',') : h;
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return remoteAddr(req);
}

/** Anyone allowed into /superadmin at all: full admins, or any is_staff account. */
export function isSuperadminStaff(user: RbacUser): boolean {
  return !!(user && (isFullAdmin(user) || user.is_staff));
}

/** Department slugs this user can see (full admins: all; others via rbac hasRole). */
export async function userDepartments(user: RbacUser, ex: Executor = db): Promise<string[]> {
  if (isFullAdmin(user)) return [...DEPARTMENT_SLUGS];
  if (!user) return [];
  const out: string[] = [];
  for (const slug of DEPARTMENT_SLUGS) if (await hasRole(user, slug, ex)) out.push(slug);
  return out;
}

/** require_department(user, department) — true if the user may access that department's module. */
export async function requireDepartment(user: RbacUser, department: string, ex: Executor = db): Promise<boolean> {
  return (await userDepartments(user, ex)).includes(department);
}

/** DRF permission class IsSuperadminStaff (message 'Superadmin access required.'). */
export const IsSuperadminStaff: Permission = {
  has: (req) => isSuperadminStaff(req.user),
  message: 'Superadmin access required.',
};

// --- AdminAuditLog ------------------------------------------------------------------

/**
 * What log_admin_action derives from a model instance: `type` is the model
 * class name lowercased, `id` str(pk), `repr` str(instance) (the model's
 * __str__ — build it exactly like the Django model does).
 */
export interface AuditTarget { type: string; id: string; repr: string }

/** auditTarget('Listing', 12, 'Nice flat') → { type: 'listing', id: '12', repr: 'Nice flat' } */
export function auditTarget(modelClassName: string, pk: unknown, repr: string): AuditTarget {
  return { type: modelClassName.toLowerCase(), id: String(pk), repr };
}

/**
 * log_admin_action(request, action, target=None, reason='', **metadata).
 * Appends one superadmin_adminauditlog row. `metadata` holds the **kwargs
 * (values must already be JSON-ready the way Django's JSONField would store them).
 */
export async function logAdminAction(
  req: ApiRequest | (Request & { user?: { id: number } | null }),
  action: string,
  opts: { target?: AuditTarget | null; reason?: string | null; metadata?: Record<string, unknown> } = {},
  ex: Executor = db,
): Promise<void> {
  const t = opts.target ?? null;
  const ip = getClientIp(req);
  await ex.insertInto('superadmin_adminauditlog').values({
    actor_id: (req as ApiRequest).user ? (req as ApiRequest).user!.id : null,
    action,
    target_type: t ? t.type : '',
    target_id: t ? t.id : '',
    target_repr: t ? [...t.repr].slice(0, 255).join('') : '',
    reason: opts.reason || '',
    ip_address: ip || null,
    user_agent: [...String(req.headers['user-agent'] ?? '')].slice(0, 500).join(''),
    metadata: JSON.stringify(opts.metadata ?? {}),
    created_at: new Date(),
  }).execute();
}

/** Python str(datetime) for a Postgres timestamptz value: '2026-10-03 11:12:39.123456+00:00' (handy for __str__ reprs). */
export function pyDatetimeStr(value: string | Date | null | undefined): string {
  if (value === null || value === undefined) return 'None';
  if (value instanceof Date) value = value.toISOString().replace('T', ' ').replace('Z', '+00');
  return isoformat(value)!.replace('T', ' ');
}

// --- MFA (superadmin.models.MFADevice + the step-up login constants) ---------------------

/** superadmin.views.MFA_LOGIN_SALT / MFA_TOKEN_MAX_AGE (authapp.login_view signs, mfa_verify_login unsigns). */
export const MFA_LOGIN_SALT = 'superadmin-mfa-login';
export const MFA_TOKEN_MAX_AGE = 300;
export const BACKUP_CODE_COUNT = 8;

const otpGuardrails = createGuardrails({ MIN_SECRET_BYTES: 1 });

/**
 * pyotp.TOTP(secret).verify(code, valid_window=1): the current 30 s step ±1.
 * pyotp compares NFKC-normalised strings, so anything otplib rejects as a
 * malformed token (wrong length, non-digits) is simply "no match".
 */
export function totpVerify(secret: string, code: string, now = Date.now()): boolean {
  try {
    return verifySync({ secret, token: String(code).normalize('NFKC'), epoch: Math.floor(now / 1000), epochTolerance: 30, guardrails: otpGuardrails }).valid;
  } catch {
    return false;
  }
}

/** The current TOTP code for a secret (pyotp.TOTP(secret).now()). */
export function totpNow(secret: string, now = Date.now()): string {
  return generateSync({ secret, epoch: Math.floor(now / 1000), guardrails: otpGuardrails });
}

/**
 * MFADevice.verify_code_or_backup(code): a TOTP code, else (and consuming) a
 * one-time backup code — save(update_fields=['backup_codes']).
 */
export async function verifyCodeOrBackup(
  device: { id: number; secret: string; backup_codes: unknown },
  code: string,
  ex: Executor = db,
): Promise<boolean> {
  if (totpVerify(device.secret, code)) return true;
  const codes = (Array.isArray(device.backup_codes) ? device.backup_codes : []) as string[];
  for (const hashed of codes) {
    if ((await checkPassword(code, hashed)).ok) {
      const remaining = codes.filter((h) => h !== hashed);
      device.backup_codes = remaining;
      await ex.updateTable('superadmin_mfadevice').set({ backup_codes: JSON.stringify(remaining) }).where('id', '=', device.id).execute();
      return true;
    }
  }
  return false;
}
