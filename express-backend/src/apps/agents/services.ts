// agents.services — the 3-stage sourcing-agent application review
// (approval grants an AgentProfile capability, not a role change).

import type { Selectable, Updateable } from 'kysely';
import { db } from '../../db/index.js';
import type { AgentsAgentapplication } from '../../db/schema.js';
import { nowPg } from '../../lib/datetime.js';
import { logger } from '../../lib/logger.js';
import * as nsvc from '../../domain/notifications.js';
import { pyStr } from '../bookings/py.js';
import type { Executor } from '../bookings/services.js';

export type ApplicationRow = Selectable<AgentsAgentapplication>;

export const AGENT_AGREEMENT_VERSION = '1.0';
export const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted — Product Support review', ps_approved: 'PS approved — Compliance review',
  compliance_approved: 'Compliance approved — Supervisor review', approved: 'Approved', declined: 'Declined',
};
export const ACTIVE_STATUSES = ['submitted', 'ps_approved', 'compliance_approved'];
export const STAGE_FOR_STATUS: Record<string, string> = {
  submitted: 'product_support', ps_approved: 'compliance', compliance_approved: 'supervisor',
};

export class InvalidTransition extends Error {}

type NotifyName = 'notifyAgentApplicationAdvanced' | 'notifyAgentApplicationProgress' | 'notifyAgentApplicationDeclined' | 'notifyAgentApplicationApproved';

async function safeNotify(fn: NotifyName, application: ApplicationRow, ex: Executor) {
  try {
    await nsvc[fn](application, ex);
  } catch (e) {
    logger.error({ err: e }, `Agent-application notification ${fn} failed for #${application.id}`);
  }
}

async function save(application: ApplicationRow, changes: Updateable<AgentsAgentapplication>, ex: Executor) {
  const saved = await ex.updateTable('agents_agentapplication').set(changes).where('id', '=', application.id).returningAll().executeTakeFirstOrThrow();
  Object.assign(application, saved);
}

async function decline(application: ApplicationRow, stage: string, reason: unknown, ex: Executor) {
  await save(application, { status: 'declined', declined_stage: stage, decline_reason: reason ? pyStr(reason) : '', updated_at: nowPg() }, ex);
  await safeNotify('notifyAgentApplicationDeclined', application, ex);
  return application;
}

/** _grant_agent_capability(application) — get_or_create the AgentProfile, then activate it. */
async function grantAgentCapability(application: ApplicationRow, ex: Executor) {
  let profile = await ex.selectFrom('agents_agentprofile').selectAll().where('user_id', '=', application.applicant_id).executeTakeFirst();
  if (!profile) {
    profile = await ex.insertInto('agents_agentprofile').values({ user_id: application.applicant_id, is_active: true, approved_at: null, application_id: null })
      .returningAll().executeTakeFirstOrThrow();
  }
  return ex.updateTable('agents_agentprofile').set({ is_active: true, approved_at: nowPg(), application_id: application.id })
    .where('id', '=', profile.id).returningAll().executeTakeFirstOrThrow();
}

const STAGES = {
  product_support: { from: 'submitted', to: 'ps_approved', by: 'ps_reviewed_by_id', at: 'ps_reviewed_at', msg: 'This application is not awaiting Product Support review.' },
  compliance: { from: 'ps_approved', to: 'compliance_approved', by: 'compliance_reviewed_by_id', at: 'compliance_reviewed_at', msg: 'This application is not awaiting Compliance review.' },
  supervisor: { from: 'compliance_approved', to: 'approved', by: 'supervisor_reviewed_by_id', at: 'supervisor_reviewed_at', msg: 'This application is not awaiting Supervisor review.' },
} as const;

/** ps_decision / compliance_decision / supervisor_decision(application, approve, officer, reason='') */
export async function stageDecision(stage: keyof typeof STAGES, application: ApplicationRow, approve: boolean, officer: { id: number }, reason: unknown = '', ex: Executor = db) {
  const s = STAGES[stage];
  if (application.status !== s.from) throw new InvalidTransition(s.msg);
  const reviewed = { [s.by]: officer.id, [s.at]: nowPg() } as Updateable<AgentsAgentapplication>;
  if (approve) {
    await save(application, { ...reviewed, status: s.to, updated_at: nowPg() }, ex);
    if (stage === 'supervisor') {
      await grantAgentCapability(application, ex);
      await safeNotify('notifyAgentApplicationApproved', application, ex);
    } else {
      await safeNotify('notifyAgentApplicationAdvanced', application, ex);
      await safeNotify('notifyAgentApplicationProgress', application, ex);
    }
    return application;
  }
  // save(update_fields=[<by>, <at>]) — updated_at not refreshed here
  await save(application, reviewed, ex);
  return decline(application, stage, reason, ex);
}

export const psDecision = (a: ApplicationRow, approve: boolean, officer: { id: number }, reason: unknown = '', ex: Executor = db) => stageDecision('product_support', a, approve, officer, reason, ex);
export const complianceDecision = (a: ApplicationRow, approve: boolean, officer: { id: number }, reason: unknown = '', ex: Executor = db) => stageDecision('compliance', a, approve, officer, reason, ex);
export const supervisorDecision = (a: ApplicationRow, approve: boolean, officer: { id: number }, reason: unknown = '', ex: Executor = db) => stageDecision('supervisor', a, approve, officer, reason, ex);

/** user.has_perm('app_label.codename') with Django's ModelBackend (active superusers have every permission). */
export async function hasPerm(user: { id: number; is_active: boolean; is_superuser: boolean }, perm: string, ex: Executor = db): Promise<boolean> {
  if (!user.is_active) return false;
  if (user.is_superuser) return true;
  const [app, codename] = perm.split('.') as [string, string];
  const direct = await ex.selectFrom('users_user_user_permissions as up').innerJoin('auth_permission as p', 'p.id', 'up.permission_id')
    .innerJoin('django_content_type as ct', 'ct.id', 'p.content_type_id').select('p.id')
    .where('up.user_id', '=', user.id).where('p.codename', '=', codename).where('ct.app_label', '=', app).executeTakeFirst();
  if (direct) return true;
  const viaGroup = await ex.selectFrom('users_user_groups as ug').innerJoin('auth_group_permissions as gp', 'gp.group_id', 'ug.group_id')
    .innerJoin('auth_permission as p', 'p.id', 'gp.permission_id').innerJoin('django_content_type as ct', 'ct.id', 'p.content_type_id')
    .select('p.id').where('ug.user_id', '=', user.id).where('p.codename', '=', codename).where('ct.app_label', '=', app).executeTakeFirst();
  return !!viaGroup;
}
