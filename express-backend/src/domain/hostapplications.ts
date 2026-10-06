// hostapplications — what other apps import: serializers.validate_mtn_momo_number,
// HostApplicationSerializer / HostApplicationAdminSerializer, HostApplication.approved_for,
// and the agreements module (version metadata + acceptance helpers).

import type { Request } from 'express';
import type { Selectable } from 'kysely';
import { db } from '../db/index.js';
import type { HostapplicationsHostapplication } from '../db/schema.js';
import { drf, isoformat, nowPg } from '../lib/datetime.js';
import { fileUrl } from '../lib/drf.js';
import type { Executor } from './notifications.js';
import { pyRegex } from '../apps/messaging/pyutil.js';

export type HostApplication = Selectable<HostapplicationsHostapplication>;

// ---- models ------------------------------------------------------------------------------------

export const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted — Product Support review',
  ps_approved: 'PS approved — Compliance review',
  compliance_approved: 'Compliance approved — Supervisor review',
  approved: 'Approved',
  declined: 'Declined',
};
export const ACTIVE_STATUSES = ['submitted', 'ps_approved', 'compliance_approved'];

/** HostApplication.current_stage */
export function currentStage(status: string): string | null {
  return ({ submitted: 'product_support', ps_approved: 'compliance', compliance_approved: 'supervisor' } as Record<string, string>)[status] ?? null;
}

/** HostApplication.approved_for(user) */
export async function approvedFor(userId: number | null | undefined, ex: Executor = db) {
  if (!userId) return null;
  return (await ex.selectFrom('hostapplications_hostapplication').selectAll().where('applicant_id', '=', userId).where('status', '=', 'approved')
    .orderBy('updated_at', 'desc').limit(1).executeTakeFirst()) ?? null;
}

/** str(application) */
export async function hostApplicationStr(a: HostApplication, ex: Executor = db): Promise<string> {
  const u = await ex.selectFrom('users_user').select('username').where('id', '=', a.applicant_id).executeTakeFirstOrThrow();
  return `Host application #${a.id} — ${u.username} (${a.status})`;
}

// ---- serializers ---------------------------------------------------------------------------------

const MTN_MOMO_RE = pyRegex('^(231)?0?(77|88)\\d{7}$');

/** validate_mtn_momo_number(value): null when valid, else the error message. */
export function mtnMomoNumberError(value: string | null | undefined): string | null {
  const cleaned = (value || '').replace(/\P{Nd}/gu, '');
  return MTN_MOMO_RE.test(cleaned) ? null : 'Enter a valid MTN Mobile Money number (e.g. 0880123456).';
}

/** HostApplicationSerializer (admin=true → HostApplicationAdminSerializer). */
export async function serializeHostApplication(a: HostApplication, req: Request | null, opts: { admin?: boolean } = {}, ex: Executor = db) {
  const u = await ex.selectFrom('users_user').select('email').where('id', '=', a.applicant_id).executeTakeFirstOrThrow();
  const abs = (name: string | null) => (name ? fileUrl(req, name) : null);
  const out: Record<string, unknown> = {
    id: a.id, full_name: a.full_name, address: a.address, momo_number: a.momo_number, momo_network: a.momo_network, email: u.email,
    headshot_url: abs(a.headshot), id_document_url: abs(a.id_document), tax_clearance_receipt_url: abs(a.tax_clearance_receipt),
    agreement_document_url: abs(a.agreement_document), agreement_version: a.agreement_version,
    next_of_kin_name: a.next_of_kin_name, next_of_kin_relationship: a.next_of_kin_relationship, next_of_kin_phone: a.next_of_kin_phone,
    status: a.status, status_display: STATUS_LABELS[a.status] ?? a.status, current_stage: currentStage(a.status),
    declined_stage: a.declined_stage, decline_reason: a.decline_reason, can_reapply: a.status === 'declined',
    created_at: drf(a.created_at), updated_at: drf(a.updated_at),
  };
  if (opts.admin) { out.ai_risk_score = a.ai_risk_score; out.ai_rationale = a.ai_rationale; }
  return out;
}

// ---- agreements.py -------------------------------------------------------------------------------

export const AGREEMENT_KEY = 'property_owner';
export const CURRENT_AGREEMENT_VERSION = '2.0';
export const AGREEMENT_EFFECTIVE_DATE = '2026-09-12';
export const AGREEMENT_TITLE = 'Property Owner Listing Agreement';

export async function hasAcceptedCurrent(userId: number | null | undefined, ex: Executor = db): Promise<boolean> {
  if (!userId) return false;
  return !!(await ex.selectFrom('hostapplications_agreementacceptance').select('id').where('user_id', '=', userId)
    .where('agreement', '=', AGREEMENT_KEY).where('version', '=', CURRENT_AGREEMENT_VERSION).executeTakeFirst());
}

/** record_acceptance(user, ip_address) — get_or_create on (user, agreement, version). */
export async function recordAcceptance(userId: number, ipAddress: string | null, ex: Executor = db) {
  const found = await ex.selectFrom('hostapplications_agreementacceptance').selectAll().where('user_id', '=', userId)
    .where('agreement', '=', AGREEMENT_KEY).where('version', '=', CURRENT_AGREEMENT_VERSION).executeTakeFirst();
  if (found) return found;
  return ex.insertInto('hostapplications_agreementacceptance').values({
    user_id: userId, agreement: AGREEMENT_KEY, version: CURRENT_AGREEMENT_VERSION, accepted_at: nowPg(), ip_address: ipAddress,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function latestAcceptance(userId: number | null | undefined, ex: Executor = db) {
  if (!userId) return null;
  return (await ex.selectFrom('hostapplications_agreementacceptance').selectAll().where('user_id', '=', userId)
    .where('agreement', '=', AGREEMENT_KEY).orderBy('accepted_at', 'desc').limit(1).executeTakeFirst()) ?? null;
}

/** views._agreement_payload(user) */
export async function agreementPayload(userId: number) {
  const accepted = await latestAcceptance(userId);
  return {
    version: CURRENT_AGREEMENT_VERSION,
    effective_date: AGREEMENT_EFFECTIVE_DATE,
    title: AGREEMENT_TITLE,
    accepted: await hasAcceptedCurrent(userId),
    accepted_version: accepted ? accepted.version : null,
    accepted_at: accepted ? isoformat(accepted.accepted_at) : null,
  };
}
