// hostapplications/services.py — stage transitions + notifications, and the
// Django permission check (user.has_perm) the reviewer queue relies on.

import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import type { User } from '../../lib/view.js';
import * as nsvc from '../../domain/notifications.js';
import { AGREEMENT_EFFECTIVE_DATE, CURRENT_AGREEMENT_VERSION, type HostApplication } from '../../domain/hostapplications.js';
import { saveUpload } from '../../lib/upload.js';
import { pyStr, pyTruthy } from '../messaging/pyutil.js';
import { renderOwnerAgreementPdf } from './pdf.js';

export class InvalidTransition extends Error {}

type NotifyName = 'notifyHostApplicationDeclined' | 'notifyHostApplicationAdvanced' | 'notifyHostApplicationProgress' | 'notifyHostApplicationApproved';

async function safeNotify(fn: NotifyName, a: HostApplication) {
  try {
    await nsvc[fn](a);
  } catch (err) {
    logger.error({ err }, `Host-application notification ${fn} failed for #${a.id}`);
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * _generate_agreement_safely → agreements.generate_and_store_owner_agreement:
 * render the Property Owner Agreement, store it as
 * host_agreements/property_owner_agreement_<pk>_v<version>.pdf, set
 * agreement_document / agreement_version. Django renders with WeasyPrint; this
 * backend writes a text rendering of the same template (see _deps/pdf.ts).
 * Failures are logged and never block the approval.
 */
async function generateAgreementSafely(a: HostApplication): Promise<HostApplication> {
  try {
    const now = new Date();
    const context = {
      owner_full_name: a.full_name, city: 'Monrovia', county: 'Montserrado',
      day: now.getUTCDate(), month: MONTHS[now.getUTCMonth()], year: now.getUTCFullYear(),
      version: CURRENT_AGREEMENT_VERSION, effective_date: AGREEMENT_EFFECTIVE_DATE,
    };
    const pdf = await renderOwnerAgreementPdf(context);
    const name = await saveUpload('host_agreements/', `property_owner_agreement_${a.id}_v${CURRENT_AGREEMENT_VERSION}.pdf`, pdf, 100);
    return await save(a.id, { agreement_document: name, agreement_version: CURRENT_AGREEMENT_VERSION, updated_at: nowPg() });
  } catch (err) {
    logger.error({ err }, `Owner-agreement PDF generation failed for host application #${a.id}`);
    return a;
  }
}

async function save(id: number, set: Record<string, unknown>) {
  return db.updateTable('hostapplications_hostapplication').set(set).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
}

/** `reason` is the raw request value: the DB column gets str(reason), the in-memory instance
 * (what the notification's data JSON is built from) keeps the original type, e.g. an int. */
async function decline(a: HostApplication, stage: string, reason: unknown) {
  const saved = await save(a.id, { status: 'declined', declined_stage: stage, decline_reason: pyTruthy(reason) ? pyStr(reason) : '', updated_at: nowPg() });
  await safeNotify('notifyHostApplicationDeclined', { ...saved, decline_reason: (pyTruthy(reason) ? reason : '') as string });
  return saved;
}

const STAGES: Record<string, { from: string; to: string; by: string; at: string; stage: string; msg: string }> = {
  product_support: { from: 'submitted', to: 'ps_approved', by: 'ps_reviewed_by_id', at: 'ps_reviewed_at', stage: 'product_support', msg: 'This application is not awaiting Product Support review.' },
  compliance: { from: 'ps_approved', to: 'compliance_approved', by: 'compliance_reviewed_by_id', at: 'compliance_reviewed_at', stage: 'compliance', msg: 'This application is not awaiting Compliance review.' },
  supervisor: { from: 'compliance_approved', to: 'approved', by: 'supervisor_reviewed_by_id', at: 'supervisor_reviewed_at', stage: 'supervisor', msg: 'This application is not awaiting Supervisor review.' },
};

/** ps_decision / compliance_decision / supervisor_decision */
export async function stageDecision(stage: string, a: HostApplication, approve: boolean, officer: { id: number }, reason: unknown): Promise<HostApplication> {
  const s = STAGES[stage]!;
  if (a.status !== s.from) throw new InvalidTransition(s.msg);
  const now = nowPg();
  if (approve) {
    const saved = await save(a.id, { status: s.to, [s.by]: officer.id, [s.at]: now, updated_at: nowPg() });
    if (stage === 'supervisor') {
      await promoteToHost(saved.applicant_id);
      const withDoc = await generateAgreementSafely(saved);
      await safeNotify('notifyHostApplicationApproved', withDoc);
      return withDoc;
    } else {
      await safeNotify('notifyHostApplicationAdvanced', saved);
      await safeNotify('notifyHostApplicationProgress', saved);
    }
    return saved;
  }
  const reviewed = await save(a.id, { [s.by]: officer.id, [s.at]: now });
  return decline(reviewed, s.stage, reason);
}

/** _promote_to_host(user) */
async function promoteToHost(userId: number) {
  await db.updateTable('users_user').set({ role: 'agent' }).where('id', '=', userId).where('role', '=', 'user').execute();
}

/** ModelBackend: user.has_perm('app_label.codename') */
export async function hasPerm(user: User, perm: string): Promise<boolean> {
  if (!user.is_active) return false;
  if (user.is_superuser) return true;
  const [app, codename] = perm.split('.') as [string, string];
  const direct = await db.selectFrom('users_user_user_permissions as up')
    .innerJoin('auth_permission as p', 'p.id', 'up.permission_id')
    .innerJoin('django_content_type as ct', 'ct.id', 'p.content_type_id')
    .select('p.id').where('up.user_id', '=', user.id).where('ct.app_label', '=', app).where('p.codename', '=', codename).executeTakeFirst();
  if (direct) return true;
  const viaGroup = await db.selectFrom('users_user_groups as ug')
    .innerJoin('auth_group_permissions as gp', 'gp.group_id', 'ug.group_id')
    .innerJoin('auth_permission as p', 'p.id', 'gp.permission_id')
    .innerJoin('django_content_type as ct', 'ct.id', 'p.content_type_id')
    .select('p.id').where('ug.user_id', '=', user.id).where('ct.app_label', '=', app).where('p.codename', '=', codename).executeTakeFirst();
  return !!viaGroup;
}
