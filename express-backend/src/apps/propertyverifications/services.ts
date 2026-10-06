// propertyverifications.services + serializers + Django model-permission check (user.has_perm).

import type { Request } from 'express';
import type { Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { PropertyverificationsPropertyverification } from '../../db/schema.js';
import { drf, nowPg } from '../../lib/datetime.js';
import { fileUrl } from '../../lib/drf.js';
import { logger } from '../../lib/logger.js';
import { pyTruthy } from '../../lib/py.js';
import type { User } from '../../lib/view.js';
import * as nsvc from '../../domain/notifications.js';
import { saveListing } from '../listings/models.js';
import { pystr } from '../listings/drf.js';

export type Verification = Selectable<PropertyverificationsPropertyverification>;

export const APPROVE = 'approve';
export const REJECT = 'reject';
export const REQUEST_CORRECTION = 'request_correction';

export const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted — Product Support review',
  ps_approved: 'PS approved — Compliance review',
  compliance_approved: 'Compliance approved — Supervisor review',
  approved: 'Approved & Published',
  rejected: 'Rejected',
  correction_requested: 'Correction Requested',
};

/** PropertyVerification.current_stage */
export function currentStage(status: string): string | null {
  return ({ submitted: 'product_support', ps_approved: 'compliance', compliance_approved: 'supervisor' } as Record<string, string>)[status] ?? null;
}

export class InvalidTransition extends Error {}

/** User.has_perm('app_label.codename') via ModelBackend (active superusers have every permission). */
export async function hasDjangoPerm(user: User | null, perm: string): Promise<boolean> {
  if (!user || !user.is_active) return false;
  if (user.is_superuser) return true;
  const [app, codename] = perm.split('.') as [string, string];
  const direct = await db.selectFrom('users_user_user_permissions as up').innerJoin('auth_permission as p', 'p.id', 'up.permission_id')
    .innerJoin('django_content_type as ct', 'ct.id', 'p.content_type_id').select('p.id')
    .where('up.user_id', '=', user.id).where('p.codename', '=', codename).where('ct.app_label', '=', app).executeTakeFirst();
  if (direct) return true;
  const group = await db.selectFrom('users_user_groups as ug').innerJoin('auth_group_permissions as gp', 'gp.group_id', 'ug.group_id')
    .innerJoin('auth_permission as p', 'p.id', 'gp.permission_id').innerJoin('django_content_type as ct', 'ct.id', 'p.content_type_id')
    .select('p.id').where('ug.user_id', '=', user.id).where('p.codename', '=', codename).where('ct.app_label', '=', app).executeTakeFirst();
  return !!group;
}

/** PropertyVerification.__str__ */
export async function verificationStr(v: Verification): Promise<string> {
  const l = await db.selectFrom('listings_listing').select('title').where('id', '=', v.listing_id).executeTakeFirstOrThrow();
  return `Verification #${v.id} — ${l.title} (${v.status})`;
}

/** PropertyVerificationSerializer (`admin` → PropertyVerificationAdminSerializer). */
/** PropertyVerification.objects.create(...) with the model defaults. */
export async function createVerification(f: {
  listing_id: number; applicant_id: number; ownership_type: string; owner_name: string; property_location: string;
  deed_volume_number: string; page_number: string; mou_document?: string;
}): Promise<Verification> {
  const now = nowPg();
  return db.insertInto('propertyverifications_propertyverification').values({
    mou_document: '', ...f, due_diligence_done: null, inspection_report: '', inspection_latitude: null, inspection_longitude: null,
    owner_authorization_confirmed: null, status: 'submitted', ps_reviewed_by_id: null, ps_reviewed_at: null,
    compliance_reviewed_by_id: null, compliance_reviewed_at: null, supervisor_reviewed_by_id: null, supervisor_reviewed_at: null,
    outcome_stage: '', review_notes: '', resubmission_count: 0, ai_risk_score: null, ai_rationale: '', created_at: now, updated_at: now,
  }).returningAll().executeTakeFirstOrThrow();
}

export async function serializeVerifications(rows: Verification[], req: Request | null, admin = false, overrides: Map<number, Record<string, unknown>> = new Map()) {
  if (!rows.length) return [];
  const ls = await db.selectFrom('listings_listing').select(['id', 'title']).where('id', 'in', [...new Set(rows.map((r) => r.listing_id))]).execute();
  const by = new Map(ls.map((l) => [l.id, l.title]));
  return rows.map((v) => {
    const out: Record<string, unknown> = {
      id: v.id, listing: v.listing_id, listing_title: by.get(v.listing_id), ownership_type: v.ownership_type, owner_name: v.owner_name,
      property_location: v.property_location, deed_volume_number: v.deed_volume_number, page_number: v.page_number,
      mou_document_url: v.mou_document ? fileUrl(req, v.mou_document) : null,
      status: v.status, status_display: STATUS_LABELS[v.status] ?? v.status, current_stage: currentStage(v.status),
      outcome_stage: v.outcome_stage, review_notes: v.review_notes, can_resubmit: v.status === 'correction_requested',
      resubmission_count: v.resubmission_count, created_at: drf(v.created_at), updated_at: drf(v.updated_at),
    };
    if (admin) {
      Object.assign(out, {
        ai_risk_score: v.ai_risk_score, ai_rationale: v.ai_rationale, due_diligence_done: v.due_diligence_done,
        inspection_report_url: v.inspection_report ? fileUrl(req, v.inspection_report) : null,
        inspection_latitude: v.inspection_latitude, inspection_longitude: v.inspection_longitude,
      }, overrides.get(v.id) ?? {});
    }
    return out;
  });
}

/** _safe_notify(fn_name, verification) */
export async function safeNotify(fn: keyof typeof nsvc, v: Verification) {
  try {
    await (nsvc[fn] as (v: nsvc.VerificationLike) => Promise<void>)(v);
  } catch (e) {
    logger.error({ err: e, verification: v.id }, `Property-verification notification ${String(fn)} failed`);
  }
}

async function update(v: Verification, set: Record<string, unknown>): Promise<Verification> {
  return db.updateTable('propertyverifications_propertyverification').set(set as never).where('id', '=', v.id).returningAll().executeTakeFirstOrThrow();
}

/** _set_listing_status */
async function setListingStatus(v: Verification, status: string) {
  const l = await db.selectFrom('listings_listing').select(['id', 'status']).where('id', '=', v.listing_id).executeTakeFirstOrThrow();
  if (l.status !== status) await saveListing(l.id, { status }, { updateFields: ['status'] });
}

const STAGE_FIELDS: Record<string, [string, string]> = {
  product_support: ['ps_reviewed_by_id', 'ps_reviewed_at'],
  compliance: ['compliance_reviewed_by_id', 'compliance_reviewed_at'],
  supervisor: ['supervisor_reviewed_by_id', 'supervisor_reviewed_at'],
};

export { pyTruthy };
const notesStr = (notes: unknown) => (pyTruthy(notes) ? pystr(notes) : '');

/**
 * Django notifies with the in-memory instance, whose review_notes is still the raw request
 * value (`notes or ''`) — a list stays a list in Notification.data, and str(list) in the message.
 */
class RawNotes {
  constructor(private raw: unknown) {}
  toString() { return pystr(this.raw); }
  toJSON() { return this.raw; }
}
const inMemory = (v: Verification, notes: unknown): Verification =>
  (pyTruthy(notes) && typeof notes !== 'string' ? { ...v, review_notes: new RawNotes(notes) as unknown as string } : v);

async function applyDecision(v: Verification, decision: string, stage: string, notes: unknown, officer: User, approvedStatus: string,
  onApprove?: (v: Verification) => Promise<void>): Promise<Verification> {
  const [byCol, atCol] = STAGE_FIELDS[stage]!;
  const stamp = { [byCol]: officer.id, [atCol]: nowPg(), updated_at: nowPg() };
  if (decision === APPROVE) {
    v = await update(v, { status: approvedStatus, ...stamp });
    if (onApprove) await onApprove(v);
    else { await safeNotify('notifyPropertyVerificationAdvanced', v); await safeNotify('notifyPropertyVerificationProgress', v); }
    return v;
  }
  v = await update(v, stamp);
  if (decision === REQUEST_CORRECTION) {
    v = await update(v, { status: 'correction_requested', outcome_stage: stage, review_notes: notesStr(notes), updated_at: nowPg() });
    await setListingStatus(v, 'pending_review');
    await safeNotify('notifyPropertyVerificationCorrection', inMemory(v, notes));
    return v;
  }
  v = await update(v, { status: 'rejected', outcome_stage: stage, review_notes: notesStr(notes), updated_at: nowPg() });
  await setListingStatus(v, 'rejected');
  await safeNotify('notifyPropertyVerificationRejected', inMemory(v, notes));
  return v;
}

export async function psDecision(v: Verification, decision: string, officer: User, notes: unknown = '') {
  if (v.status !== 'submitted') throw new InvalidTransition('This verification is not awaiting Product Support review.');
  return applyDecision(v, decision, 'product_support', notes, officer, 'ps_approved');
}

export interface InspectionData {
  due_diligence_done?: boolean; inspection_report?: string; inspection_latitude?: string; inspection_longitude?: string; owner_authorization_confirmed?: boolean;
}

export async function complianceDecision(v: Verification, decision: string, officer: User, notes: unknown = '', inspection: InspectionData = {}) {
  if (v.status !== 'ps_approved') throw new InvalidTransition('This verification is not awaiting Compliance review.');
  if (decision === APPROVE) {
    const set: Record<string, unknown> = {};
    for (const k of ['due_diligence_done', 'inspection_report', 'inspection_latitude', 'inspection_longitude', 'owner_authorization_confirmed'] as const) {
      if (inspection[k] !== undefined && inspection[k] !== null) set[k] = inspection[k];
    }
    if (Object.keys(set).length) v = await update(v, set);
    if (!v.due_diligence_done || !v.inspection_report) {
      throw new InvalidTransition('A completed site inspection (due-diligence confirmation + inspection report) is required before Compliance can approve.');
    }
    if (v.ownership_type === 'agent' && !v.owner_authorization_confirmed) {
      throw new InvalidTransition('For agent-sourced properties, you must confirm the owner authorized this agent (and the payout number) before Compliance can approve.');
    }
  }
  return applyDecision(v, decision, 'compliance', notes, officer, 'compliance_approved');
}

export async function supervisorDecision(v: Verification, decision: string, officer: User, notes: unknown = '') {
  if (v.status !== 'compliance_approved') throw new InvalidTransition('This verification is not awaiting Supervisor review.');
  return applyDecision(v, decision, 'supervisor', notes, officer, 'approved', async (vv) => {
    await saveListing(vv.listing_id, { status: 'published', is_available: true }, { updateFields: ['status', 'is_available'] });
    await safeNotify('notifyPropertyVerificationPublished', vv);
  });
}

/** services.resubmit */
export async function resubmit(v: Verification): Promise<Verification> {
  if (v.status !== 'correction_requested') throw new InvalidTransition('This verification is not awaiting correction.');
  v = await update(v, { status: 'submitted', outcome_stage: '', review_notes: '', resubmission_count: v.resubmission_count + 1, updated_at: nowPg() });
  await setListingStatus(v, 'pending_review');
  await safeNotify('notifyPropertyVerificationSubmitted', v);
  return v;
}
