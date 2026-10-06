// hostapplications — /api/host-applications/ (port of hostapplications/views.py + urls.py).

import { db } from '../../db/index.js';
import { remoteAddr } from '../../lib/clientIp.js';
import { nowPg } from '../../lib/datetime.js';
import { notFoundFor } from '../../lib/errors.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { notifyHostApplicationReceived, notifyHostApplicationSubmitted } from '../../domain/notifications.js';
import { hasPermission } from '../../domain/rbac.js';
import { auditTarget, logAdminAction } from '../../domain/superadmin.js';
import {
  ACTIVE_STATUSES, agreementPayload, currentStage, hostApplicationStr, mtnMomoNumberError, recordAcceptance, serializeHostApplication,
} from '../../domain/hostapplications.js';
import { BooleanField, CharField, FieldError, ImageField, invalid, validate } from '../messaging/drf.js';
import { pyStr, pyStrip, pyTruthy } from '../messaging/pyutil.js';
import { dget, parseRequest, type Upload } from '../messaging/request.js';
import { saveUpload } from '../../lib/upload.js';
import { urlId } from '../messaging/urls.js';
import { delay } from '../../lib/jobs.js';
import { hasPerm, InvalidTransition, stageDecision } from './services.js';

/** _client_ip: first X-Forwarded-For hop, else REMOTE_ADDR. */
function clientIp(req: ApiRequest): string | null {
  const fwd = req.headers['x-forwarded-for'];
  const f = Array.isArray(fwd) ? fwd.join(',') : fwd ?? '';
  if (f) return pyStrip(f.split(',')[0]!);
  return remoteAddr(req) || null;
}

const STAGE_PERMISSION: Record<string, string> = {
  product_support: 'hostapplications.review_product_support',
  compliance: 'hostapplications.review_compliance',
  supervisor: 'hostapplications.review_supervisor',
};
const STAGE_STATUS: Record<string, string> = { product_support: 'submitted', compliance: 'ps_approved', supervisor: 'compliance_approved' };

const backgroundChecks = (req: ApiRequest) => hasPermission(req.user, 'trust_safety.background_checks', 'execute');

async function reviewableStages(req: ApiRequest): Promise<string[]> {
  if (await backgroundChecks(req)) return Object.keys(STAGE_PERMISSION);
  const out: string[] = [];
  for (const [stage, perm] of Object.entries(STAGE_PERMISSION)) if (await hasPerm(req.user!, perm)) out.push(stage);
  return out;
}

const r = djangoRouter('api/host-applications/');

// ---- host_applications_collection ------------------------------------------------------------------
r.path('', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const { data } = await parseRequest(req, res);
    const user = req.user!;
    const v = await validate(data, [
      ['full_name', CharField({ maxLength: 255 })],
      ['address', CharField({ maxLength: 500 })],
      ['momo_number', CharField({ maxLength: 30 }), (x) => { const e = mtnMomoNumberError(String(x)); if (e) invalid(e); return x; }],
      ['headshot', ImageField({ maxLength: 100 })],
      ['id_document', ImageField({ maxLength: 100 })],
      ['agreement_accepted', BooleanField(), (x) => { if (!x) invalid('You must agree to the Property Owner Agreement to apply.'); return x; }],
    ], {
      async validate(attrs) {
        const active = await db.selectFrom('hostapplications_hostapplication').select('id').where('applicant_id', '=', user.id)
          .where('status', 'in', ACTIVE_STATUSES).executeTakeFirst();
        if (active) throw new FieldError('You already have an application under review.');
        delete attrs.agreement_accepted;
        return attrs;
      },
    });
    if (v.errors) return res.status(400).json(v.errors);
    const d = v.values as { full_name: string; address: string; momo_number: string; headshot: Upload; id_document: Upload };
    const headshot = await saveUpload('host_applications/headshots/', d.headshot.name, d.headshot.buffer, 100);
    const idDoc = await saveUpload('host_applications/ids/', d.id_document.name, d.id_document.buffer, 100);
    const now = nowPg();
    const app = await db.insertInto('hostapplications_hostapplication').values({
      applicant_id: user.id, full_name: d.full_name, address: d.address, momo_number: d.momo_number, momo_network: 'mtn',
      headshot, id_document: idDoc, tax_clearance_receipt: '', next_of_kin_name: '', next_of_kin_relationship: '', next_of_kin_phone: '',
      agreement_document: '', agreement_version: '', status: 'submitted',
      ps_reviewed_by_id: null, ps_reviewed_at: null, compliance_reviewed_by_id: null, compliance_reviewed_at: null,
      supervisor_reviewed_by_id: null, supervisor_reviewed_at: null, declined_stage: '', decline_reason: '',
      ai_risk_score: null, ai_rationale: '', created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();

    await delay('aiscoring.tasks.score_host_application_task', [app.id]);
    await recordAcceptance(user.id, clientIp(req));
    try {
      await notifyHostApplicationSubmitted(app);
      await notifyHostApplicationReceived(app);
    } catch { /* never break the submission */ }
    return res.status(201).json(await serializeHostApplication(app, req));
  },
}));

// ---- my_host_application --------------------------------------------------------------------------
r.path('me/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const app = await db.selectFrom('hostapplications_hostapplication').selectAll().where('applicant_id', '=', req.user!.id)
      .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
    if (!app) return res.status(204).end();
    return serializeHostApplication(app, req);
  },
}));

// ---- agreement_status / accept_agreement -------------------------------------------------------------
r.path('agreement/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) { return agreementPayload(req.user!.id); },
}));

r.path('agreement/accept/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    await recordAcceptance(req.user!.id, clientIp(req));
    return res.status(201).json(await agreementPayload(req.user!.id));
  },
}));

// ---- review_queue -------------------------------------------------------------------------------------
r.path('review-queue/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const stages = await reviewableStages(req);
    if (!stages.length) return res.status(403).json({ error: 'You are not a reviewer for any stage of this queue.' });
    const rows = await db.selectFrom('hostapplications_hostapplication').selectAll()
      .where('status', 'in', stages.map((s) => STAGE_STATUS[s]!)).orderBy('created_at').execute();
    const out = [];
    for (const a of rows) out.push(await serializeHostApplication(a, req, { admin: true }));
    return out;
  },
}));

// ---- review_decision ------------------------------------------------------------------------------------
r.path('<int:pk>/review/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const id = urlId(req.params.pk);
    const app = id === null ? undefined : await db.selectFrom('hostapplications_hostapplication').selectAll().where('id', '=', id).executeTakeFirst();
    if (!app) throw notFoundFor('HostApplication');
    const stage = currentStage(app.status);
    if (stage === null) return res.status(400).json({ error: 'This application is not awaiting review.' });
    if (!((await backgroundChecks(req)) || (await hasPerm(req.user!, STAGE_PERMISSION[stage]!)))) {
      return res.status(403).json({ error: 'You are not authorized to review this stage.' });
    }
    const { data } = await parseRequest(req, res);
    const approve = pyTruthy(dget(data, 'approve'));
    const reasonRaw = dget(data, 'reason', '');
    if (!approve && !pyStrip(pyStr(reasonRaw))) return res.status(400).json({ error: 'A reason is required when declining.' });
    const reasonStored = pyTruthy(reasonRaw) ? pyStr(reasonRaw) : '';
    let saved;
    try {
      saved = await stageDecision(stage, app, approve, req.user!, reasonRaw);
    } catch (e) {
      if (e instanceof InvalidTransition) return res.status(400).json({ error: e.message });
      throw e;
    }
    await logAdminAction(req, 'host_application.review', {
      target: auditTarget('HostApplication', saved.id, await hostApplicationStr(saved)),
      reason: reasonStored,
      metadata: { approved: approve, stage },
    });
    return serializeHostApplication(saved, req, { admin: true });
  },
}));
