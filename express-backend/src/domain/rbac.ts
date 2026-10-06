// rbac — permission engine shared by every app (port of rbac/resources.py,
// rbac/permissions.py, rbac/preset_roles.py and rbac/dual_auth.py).
//
//   import { hasPermission, hasAnyPermission, isFullAdmin, hasRole } from '../../domain/rbac.js';
//   if (!(await hasPermission(req.user, 'finances.payouts', 'execute'))) ...
//
// All checks accept `req.user` directly (null = AnonymousUser).

import type { Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';
import { db, type DB } from '../db/index.js';
import type { RbacPendingapproval } from '../db/schema.js';
import { pyStr } from '../lib/py.js';

type Executor = typeof db | Transaction<DB>;

/** The subset of users_user the checks read. `null`/`undefined` = anonymous. */
export type RbacUser = { id: number; role: string; is_superuser: boolean; is_staff?: boolean } | null | undefined;

// --- rbac/resources.py ----------------------------------------------------------

export const ACTIONS = ['create', 'read', 'update', 'delete', 'execute'] as const;
export type RbacAction = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<string, string> = {
  create: 'Create', read: 'Read', update: 'Update', delete: 'Delete', execute: 'Execute',
};

/** (path, label, wired, note) — same order as RESOURCE_TREE. */
export const RESOURCE_TREE: [string, string, boolean, string][] = [
  ['users', 'Users', true, 'Wildcard — grants every user sub-resource below (profiles, PII, behavior logs, impersonation).'],
  ['users.profiles', 'Profiles', true, 'Basic account metadata — user list/search (users app).'],
  ['users.pii', 'PII', true, 'Emails, phone numbers, government ID documents captured during KYC review.'],
  ['users.behavior_logs', 'Behavior Logs', false, 'Signup IPs and device fingerprints (trustsafety.AccountSignupEvent) — captured on signup, but there is no admin endpoint to browse them yet (Django admin only). Granting this does nothing until that endpoint exists.'],
  ['users.impersonation', 'Impersonation', true, '"Login as" another user for support/debugging (superadmin.impersonate_start/stop) — every action taken is logged under the real admin\'s identity.'],
  ['users.staff_management', 'Staff Management', true, 'Onboard internal staff (position/department, linking or creating their account), view their profile and education/legal records (superadmin.StaffProfile). Role/permission assignment itself still goes through the RBAC engine (rbac.user-roles).'],

  ['listings', 'Listings', true, 'Wildcard — grants every listing sub-resource below (content, availability, compliance).'],
  ['listings.content', 'Content', true, 'Titles, descriptions, photos — approve/reject pending listings (listings app).'],
  ['listings.availability', 'Availability', true, 'Booking status, suspension state (inventory app).'],
  ['listings.compliance', 'Compliance', true, 'Local registration number + legal occupancy cap (Listing.local_registration_number/occupancy_cap) — enforced against the host\'s own max_guests. Set via PATCH /api/inventory/listings/<id>/compliance/.'],
  ['listings.settings', 'Listing Settings', true, 'Minimum listing price enforced at listing creation (listings.ListingSettings) — takes effect immediately, no deploy needed.'],
  ['listings.categories', 'Property Categories', true, 'Category taxonomy used to tag/browse listings (listings.PropertyCategory) — managed via the generic admin CRUD system.'],
  ['listings.bulk_import', 'Bulk Import/Export', true, 'Bulk-create or export listings via XLSX on behalf of any owner (listings.bulk) — a normal host only ever imports/exports their own.'],

  ['reservations', 'Reservations', true, 'Wildcard — grants every reservation sub-resource below (transactional data, communications).'],
  ['reservations.transactional_data', 'Transactional Data', true, 'Booking dates, guest counts, payment confirmation (bookings app).'],
  ['reservations.communications', 'Communications', true, 'Read-only admin view of the in-app message thread(s) between guest and host for a given booking (GET /api/bookings/admin/<id>/communications/), for dispute investigation.'],

  ['finances', 'Finances', true, 'Wildcard — grants every finance sub-resource below (escrow, payouts, taxes, legal documents, platform fees, vouchers).'],
  ['finances.escrow', 'Escrow', true, 'Bookings whose guest payment has landed but not yet been confirmed/disbursed (payments.EscrowHold can freeze one pending investigation, blocking admin_confirm_payment).'],
  ['finances.payouts', 'Payouts', true, 'Host payout records — mark paid, cancel, disburse via MTN MoMo (payments.Payout), and confirming guest payments (which creates the payout).'],
  ['finances.agent_commissions', 'Agent Commissions', true, 'Sourcing-agent commission records — mark paid / disburse via MTN MoMo (agents.AgentCommission).'],
  ['finances.employees', 'Employee Payments', true, 'Internal employee roster + ad-hoc MTN MoMo disbursements to them (payments.Employee / payments.EmployeePayment).'],
  ['finances.taxes', 'Taxes', true, 'Per-jurisdiction occupancy tax rates (payments.TaxRate) + a computed liability report over confirmed bookings. No withholding/filing/remittance automation.'],
  ['finances.currencies', 'Currency Exchange Rates', true, 'USD conversion rate per non-USD currency (payments.Currency.exchange_rate_to_usd) — used to convert a booking/viewing-fee\'s USD price into whatever currency the guest chooses at MTN MoMo checkout. Takes effect immediately, no deploy needed. Rate/name/symbol/active-status editing only — currency codes themselves are not editable and currencies cannot be created or deleted here (see payments.admin.CurrencyAdmin for that, Django-admin only, deliberately harder to reach).'],
  ['finances.legal_documents', 'Legal Documents', true, 'Terms of Service / Privacy Policy version registry (legalops app).'],
  ['finances.platform_fee', 'Platform Fee', true, 'Booking/viewing/service fee configuration (payments.PlatformFee) — takes effect immediately, no deploy needed.'],

  ['trust_safety', 'Trust & Safety', true, 'Wildcard — grants every trust & safety sub-resource below (background checks, flags, bans).'],
  ['trust_safety.background_checks', 'Background Checks', true, 'Identity/ownership verification review is manual, not automated screening — this permission (execute) grants access to every stage of the KYC review queue (hostapplications/propertyverifications), additive to the existing per-stage Django model permissions.'],
  ['trust_safety.flags', 'Flags', true, 'Rule-based fraud/listing-moderation flags (trustsafety.FraudFlag, inventory.ListingFlag).'],
  ['trust_safety.bans', 'Bans', true, 'Device/location blocks and account suspensions (trustsafety.BlockedFingerprint/BlacklistedLocation, suspensions.Suspension).'],

  ['customer_support', 'Customer Support', true, 'Wildcard — grants every support sub-resource below (tickets, disputes, AirCover claims, vouchers).'],
  ['customer_support.tickets', 'Tickets', true, 'Support ticket queue, replies, escalation (support app).'],
  ['customer_support.disputes', 'Disputes', true, 'User-submitted reports about listings/users/reviews/messages (reports.Report) — review, resolve, dismiss, escalate.'],
  ['customer_support.aircover_claims', 'AirCover Claims', true, 'Property/liability damage claim intake + review (support.AirCoverClaim). Approving a claim records an approved amount but never auto-disburses money — finance still manually issues that via the existing refund/payout tools.'],
  ['customer_support.vouchers', 'Vouchers', true, 'Discretionary refunds — backed by the real MTN MoMo refund endpoint (payments.admin_refund_payment). Amounts above the dual-authorization threshold require a second approver regardless of role.'],

  ['infrastructure', 'Infrastructure', true, 'Wildcard — grants every infrastructure sub-resource below (feature flags, caches, break-glass).'],
  ['infrastructure.feature_flags', 'Feature Flags', true, 'Platform-wide toggles (platformops.FeatureFlag).'],
  ['infrastructure.system_caches', 'System Caches', true, 'Flushes the configured Django cache backend (Redis in production).'],
  ['infrastructure.break_glass', 'Break-Glass', true, 'Request temporary full-admin elevation during an incident (rbac.BreakGlassSession) — also grantable via the built-in engineering role.'],

  ['marketing', 'Marketing', true, 'Wildcard — grants every marketing sub-resource below (testimonials, newsletter).'],
  ['marketing.testimonials', 'Testimonials', true, 'Approve/moderate customer testimonials shown on the public site (testimonials app).'],
  ['marketing.newsletter', 'Newsletter', true, 'Subscriber list management (newsletter app).'],

  ['rbac_engine', 'RBAC Engine', true, 'Create/edit custom roles and assign them to other admin accounts. Restricted to full admins by default — this is the permission that grants every other permission.'],
  ['audit_log', 'Audit Log', true, 'View the admin audit trail (superadmin.AdminAuditLog) — every sensitive action taken from this dashboard, who/what/when/why.'],
];

export const RESOURCE_PATHS = new Set(RESOURCE_TREE.map((r) => r[0]));
export const RESOURCE_LABELS: Record<string, string> = Object.fromEntries(RESOURCE_TREE.map((r) => [r[0], r[1]]));
export const WIRED_RESOURCES = new Set(RESOURCE_TREE.filter((r) => r[2]).map((r) => r[0]));

export function isValidResource(path: unknown): boolean {
  return typeof path === 'string' && RESOURCE_PATHS.has(path);
}

/** 'trust_safety.flags' -> ['trust_safety.flags', 'trust_safety'] */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('.');
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join('.'));
  return out;
}

// --- rbac/permissions.py --------------------------------------------------------

/** role == 'superadmin' or is_superuser (the 'admin' tier is NOT a full admin). */
export function isFullAdmin(user: RbacUser): boolean {
  return !!(user && (user.role === 'superadmin' || user.is_superuser));
}

/** Active (unrevoked, unexpired) BreakGlassSession for this user. */
export async function hasActiveBreakGlass(user: RbacUser, ex: Executor = db): Promise<boolean> {
  if (!user) return false;
  const r = await ex.selectFrom('rbac_breakglasssession').select('id')
    .where('user_id', '=', user.id).where('revoked_at', 'is', null).where('expires_at', '>', sql<string>`now()`)
    .executeTakeFirst();
  return !!r;
}

/** Role rows assigned to the user (Role.objects.filter(assignments__user=user), Meta.ordering = name). */
export async function userRoles(user: RbacUser, ex: Executor = db) {
  if (!user) return [];
  return ex.selectFrom('rbac_role').selectAll('rbac_role')
    .innerJoin('rbac_userroleassignment as a', 'a.role_id', 'rbac_role.id')
    .where('a.user_id', '=', user.id).orderBy('rbac_role.name').execute();
}

/** Holds the role slug (full admins / active break-glass always do). Backs require_department(). */
export async function hasRole(user: RbacUser, roleSlug: string, ex: Executor = db): Promise<boolean> {
  if (isFullAdmin(user) || (await hasActiveBreakGlass(user, ex))) return true;
  if (!user) return false;
  const r = await ex.selectFrom('rbac_role').select('rbac_role.id')
    .innerJoin('rbac_userroleassignment as a', 'a.role_id', 'rbac_role.id')
    .where('a.user_id', '=', user.id).where('rbac_role.slug', '=', roleSlug).executeTakeFirst();
  return !!r;
}

/** Any assigned role grants `action` on `resource` or an ancestor (full admins / break-glass pass; unknown resource/action → false). */
export async function hasPermission(user: RbacUser, resource: string, action: string, ex: Executor = db): Promise<boolean> {
  if (!isValidResource(resource) || !(ACTIONS as readonly string[]).includes(action)) return false;
  if (isFullAdmin(user) || (await hasActiveBreakGlass(user, ex))) return true;
  if (!user) return false;
  const r = await ex.selectFrom('rbac_rolepermission as p').select('p.id')
    .innerJoin('rbac_userroleassignment as a', 'a.role_id', 'p.role_id')
    .where('a.user_id', '=', user.id).where('p.resource', 'in', ancestorsOf(resource)).where('p.action', '=', action)
    .executeTakeFirst();
  return !!r;
}

/** Any action at all on `resource` or an ancestor. */
export async function hasAnyPermission(user: RbacUser, resource: string, ex: Executor = db): Promise<boolean> {
  if (!isValidResource(resource)) return false;
  if (isFullAdmin(user) || (await hasActiveBreakGlass(user, ex))) return true;
  if (!user) return false;
  const r = await ex.selectFrom('rbac_rolepermission as p').select('p.id')
    .innerJoin('rbac_userroleassignment as a', 'a.role_id', 'p.role_id')
    .where('a.user_id', '=', user.id).where('p.resource', 'in', ancestorsOf(resource))
    .executeTakeFirst();
  return !!r;
}

/** Every (resource, action) pair the user holds, de-duplicated (Python set; unordered). */
export async function effectiveGrants(user: RbacUser, ex: Executor = db): Promise<[string, string][]> {
  if (isFullAdmin(user)) return RESOURCE_TREE.flatMap(([path]) => ACTIONS.map((a) => [path, a] as [string, string]));
  if (!user) return [];
  const rows = await ex.selectFrom('rbac_rolepermission as p').select(['p.resource', 'p.action'])
    .innerJoin('rbac_userroleassignment as a', 'a.role_id', 'p.role_id')
    .where('a.user_id', '=', user.id).execute();
  const seen = new Map<string, [string, string]>();
  for (const r of rows) seen.set(`${r.resource}\u0000${r.action}`, [r.resource, r.action]);
  return [...seen.values()];
}

// --- rbac/preset_roles.py -------------------------------------------------------

export const PRESET_ROLE_DEFINITIONS: Record<string, { name: string; description: string; full_resources: string[]; read_only_resources: string[] }> = {
  trust_safety: {
    name: 'Trust & Safety Specialist',
    description: 'Fraud/AML review, device & location bans, account suspensions, and identity verification. Backs the legacy trust_safety department.',
    full_resources: ['trust_safety', 'users.behavior_logs'],
    read_only_resources: ['users.pii'],
  },
  inventory: {
    name: 'Inventory & Listings Moderator',
    description: 'Listing moderation queue — suspend/restore listings, review flags. Backs the legacy inventory department.',
    full_resources: ['listings'],
    read_only_resources: [],
  },
  support: {
    name: 'Customer Support Representative',
    description: 'Support ticket queue, user reports, refund vouchers, and suspensions arising from disputes. Backs the legacy support department.',
    full_resources: ['customer_support', 'trust_safety.bans'],
    read_only_resources: ['reservations.communications'],
  },
  finance: {
    name: 'Financial Operations Auditor',
    description: 'Host payouts, refunds, platform fee configuration, and legal document versioning. Backs the legacy finance department.',
    full_resources: ['finances'],
    read_only_resources: [],
  },
  engineering: {
    name: 'Product & Systems Engineer',
    description: 'Feature flags, system health, and cache management. Backs the legacy engineering department.',
    full_resources: ['infrastructure'],
    read_only_resources: [],
  },
  admin: {
    name: 'Admin',
    description:
      'Broad operational access to every part of the platform — users, listings, bookings, finance, trust & safety, support, and marketing. Second tier to ' +
      'Superadmin: cannot manage roles/permissions (rbac_engine) or request break-glass elevation, so an Admin can never self-escalate. Users with the ' +
      "app-level 'admin' role are automatically assigned this Role.",
    full_resources: [
      'users', 'listings', 'reservations', 'finances', 'trust_safety', 'customer_support',
      'infrastructure.feature_flags', 'infrastructure.system_caches', 'marketing', 'audit_log',
    ],
    read_only_resources: [],
  },
  superadmin: {
    name: 'Superadmin',
    description:
      'Unrestricted access to everything, including role/permission management and break-glass elevation. Real superadmin status comes from the account\'s ' +
      "role field (role='superadmin' or is_superuser=True), which bypasses this engine entirely (see rbac.permissions.is_full_admin) — this preset exists so " +
      "the full permission set is visible here for documentation, not because it's required for access.",
    full_resources: [
      'users', 'listings', 'reservations', 'finances', 'trust_safety', 'customer_support',
      'infrastructure', 'marketing', 'rbac_engine', 'audit_log',
    ],
    read_only_resources: [],
  },
};

/** seed_preset_roles() — idempotent (get_or_create semantics). */
export async function seedPresetRoles(ex: Executor = db): Promise<void> {
  for (const [slug, def] of Object.entries(PRESET_ROLE_DEFINITIONS)) {
    let role = await ex.selectFrom('rbac_role').selectAll().where('slug', '=', slug).executeTakeFirst();
    if (!role) {
      const now = new Date();
      role = await ex.insertInto('rbac_role').values({
        slug, name: def.name, description: def.description, is_preset: true, created_by_id: null, created_at: now, updated_at: now,
      }).returningAll().executeTakeFirstOrThrow();
    } else if (role.name !== def.name || role.description !== def.description || !role.is_preset) {
      // save(update_fields=[...]) — auto_now updated_at is NOT in update_fields, so it's untouched.
      await ex.updateTable('rbac_role').set({ name: def.name, description: def.description, is_preset: true }).where('id', '=', role.id).execute();
    }
    const grant = async (resource: string, action: string) => {
      const hit = await ex.selectFrom('rbac_rolepermission').select('id')
        .where('role_id', '=', role!.id).where('resource', '=', resource).where('action', '=', action).executeTakeFirst();
      if (!hit) await ex.insertInto('rbac_rolepermission').values({ role_id: role!.id, resource, action }).execute();
    };
    for (const r of def.full_resources) for (const a of ACTIONS) await grant(r, a);
    for (const r of def.read_only_resources) await grant(r, 'read');
  }
}

// --- rbac/dual_auth.py ----------------------------------------------------------

export type PendingApproval = Selectable<RbacPendingapproval>;
/**
 * An executor receives the approval's payload (parsed JSON) and returns a
 * result (a plain object is stored as-is; anything else as {result: String(x)}).
 * Throwing marks the approval rejected with execution_error = err.message —
 * throw an Error whose message equals Python's str(e) for parity.
 */
export type DualAuthExecutor = (payload: any) => unknown | Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const EXECUTORS = new Map<string, DualAuthExecutor>();

/** @dual_auth.register_executor(action_key) */
export function registerExecutor(actionKey: string, fn: DualAuthExecutor): DualAuthExecutor {
  EXECUTORS.set(actionKey, fn);
  return fn;
}

/** Python PermissionError raised by approve()/reject() (views map it to 403). */
export class DualAuthPermissionError extends Error {}
/** Python ValueError raised by approve()/reject() (views map it to 400). */
export class DualAuthValueError extends Error {}

/**
 * submit_or_execute(): returns [result, approval] — exactly one is null.
 * With requiresDualAuth a PendingApproval row is created (status 'pending')
 * and nothing runs; otherwise the registered executor runs immediately (its
 * exceptions propagate, as in Django).
 */
export async function submitOrExecute(
  actionKey: string, payload: unknown, requestedBy: { id: number }, reason: string, requiresDualAuth: boolean, ex: Executor = db,
): Promise<[unknown, PendingApproval | null]> {
  if (requiresDualAuth) {
    const approval = await ex.insertInto('rbac_pendingapproval').values({
      action_key: actionKey, payload: JSON.stringify(payload ?? {}), request_reason: reason ?? '', requested_by_id: requestedBy.id,
      status: 'pending', decided_by_id: null, decision_reason: '', decided_at: null, execution_result: null, execution_error: '',
      created_at: new Date(),
    }).returningAll().executeTakeFirstOrThrow();
    return [null, approval];
  }
  const fn = EXECUTORS.get(actionKey);
  if (!fn) throw new Error(`KeyError: '${actionKey}'`); // EXECUTORS[action_key]
  return [await fn(payload), null];
}

function isPlainDict(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** dual_auth.approve — runs the executor, records result/error, saves all fields. */
export async function approve(approval: PendingApproval, approvedBy: { id: number }, ex: Executor = db): Promise<PendingApproval> {
  if (approval.requested_by_id === approvedBy.id) {
    throw new DualAuthPermissionError('A different admin must approve this action than the one who requested it.');
  }
  if (approval.status !== 'pending') throw new DualAuthValueError('This request has already been decided.');
  const fn = EXECUTORS.get(approval.action_key);
  if (!fn) throw new DualAuthValueError(`No executor registered for "${approval.action_key}".`);

  const upd: Partial<Record<keyof PendingApproval, unknown>> = {};
  try {
    const result = await fn(approval.payload);
    upd.execution_result = isPlainDict(result) ? result : { result: pyStr(result) };
    upd.status = 'approved';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    upd.execution_error = msg;
    upd.status = 'rejected';
    upd.decision_reason = `Execution failed: ${msg}`;
  }
  upd.decided_by_id = approvedBy.id;
  upd.decided_at = new Date();
  const row = await ex.updateTable('rbac_pendingapproval').set({
    ...upd,
    execution_result: upd.execution_result === undefined ? undefined : JSON.stringify(upd.execution_result),
  } as never).where('id', '=', approval.id).returningAll().executeTakeFirstOrThrow();
  return row;
}

/** dual_auth.reject */
export async function reject(approval: PendingApproval, rejectedBy: { id: number }, reason = '', ex: Executor = db): Promise<PendingApproval> {
  if (approval.requested_by_id === rejectedBy.id) {
    throw new DualAuthPermissionError('A different admin must review this request than the one who submitted it.');
  }
  if (approval.status !== 'pending') throw new DualAuthValueError('This request has already been decided.');
  return ex.updateTable('rbac_pendingapproval')
    .set({ status: 'rejected', decided_by_id: rejectedBy.id, decision_reason: reason, decided_at: new Date() })
    .where('id', '=', approval.id).returningAll().executeTakeFirstOrThrow();
}

/** Python str() for simple values (None/True/False/numbers/strings). */

