// propertyverifications — /api/property-verifications/ (port of propertyverifications/views.py + urls.py).

import { extname } from 'node:path';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { HttpResponseError, notFoundFor } from '../../lib/errors.js';
import { saveUpload } from '../../lib/upload.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { hasPermission } from '../../domain/rbac.js';
import { auditTarget, logAdminAction } from '../../domain/superadmin.js';
import { delayAiScoring } from '../../domain/aiscoring.js';
import {
  dataGet, dataHas, dataItem, FieldError, floatDecimalRepr, floatToDecimalPrec, isUpload, parseRequest, pkParam, pystr, pyStrip,
  QueryDict, runSerializer, type Fields, type Upload,
} from '../listings/drf.js';
import { saveListing } from '../listings/models.js';
import type { ListingRow } from '../listings/serializers.js';
import {
  createVerification,
  APPROVE, complianceDecision, currentStage, hasDjangoPerm, InvalidTransition, psDecision, pyTruthy, REJECT, REQUEST_CORRECTION, resubmit,
  safeNotify, serializeVerifications, supervisorDecision, verificationStr, type InspectionData, type Verification,
} from './services.js';

const r = djangoRouter('api/property-verifications/');
const view = (opts: Parameters<typeof apiView>[0]) => apiView({ permissions: [IsAuthenticated], ...opts });

const ALLOWED_MOU_EXTENSIONS = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif']);
function validateMouFile(value: unknown) {
  if (!value) return value;
  const ext = extname((value as Upload).name).toLowerCase().replace(/^\.+/, '');
  if (!ALLOWED_MOU_EXTENSIONS.has(ext)) throw new FieldError(['The MOU must be a PDF or an image (PNG, JPG, JPEG, WEBP, etc.).']);
  return value;
}

function createFields(req: ApiRequest): Fields {
  return [
    ['listing', {
      kind: 'pk', pkTable: 'listings_listing',
      async validate(listing) {
        const l = listing as ListingRow;
        if (l.owner_id !== req.user!.id) throw new FieldError(['You can only verify your own listing.']);
        if (await db.selectFrom('propertyverifications_propertyverification').select('id').where('listing_id', '=', l.id).executeTakeFirst()) {
          throw new FieldError(['This listing already has a verification.']);
        }
        return l;
      },
    }],
    ['ownership_type', { kind: 'choice', choices: ['owner', 'non_owner', 'agent'] }],
    ['owner_name', { kind: 'char', maxLength: 255 }],
    ['property_location', { kind: 'char', maxLength: 500 }],
    ['deed_volume_number', { kind: 'char', maxLength: 100 }],
    ['page_number', { kind: 'char', maxLength: 100 }],
    ['mou_document', { kind: 'file', required: false, allowNull: true, maxLength: 100, validate: validateMouFile }],
  ];
}

const RESUBMIT_FIELDS: Fields = [
  ['owner_name', { kind: 'char', required: false, maxLength: 255 }],
  ['property_location', { kind: 'char', required: false, maxLength: 500 }],
  ['deed_volume_number', { kind: 'char', required: false, maxLength: 100 }],
  ['page_number', { kind: 'char', required: false, allowBlank: true, maxLength: 100 }],
  ['mou_document', { kind: 'file', required: false, allowNull: true, maxLength: 100, validate: validateMouFile }],
];

const MOU_DIR = 'property_verifications/mou/';

r.path('', view({
  async POST(req, res) {
    const { data } = await parseRequest(req, res);
    const v = await runSerializer(data, createFields(req), {
      validate: (attrs) => {
        if (attrs.ownership_type === 'non_owner' && !attrs.mou_document) {
          throw new FieldError({ mou_document: 'A notarized MOU is required when you are not the owner.' });
        }
        return attrs;
      },
    });
    if (v.errors) return res.status(400).json(v.errors);
    const vals = v.values;
    const listing = vals.listing as ListingRow;
    const mou = isUpload(vals.mou_document) ? await saveUpload(MOU_DIR, vals.mou_document.name, vals.mou_document.data) : '';
    const verification = await createVerification({
      listing_id: listing.id, applicant_id: req.user!.id, ownership_type: vals.ownership_type as string, owner_name: vals.owner_name as string,
      property_location: vals.property_location as string, deed_volume_number: vals.deed_volume_number as string,
      page_number: vals.page_number as string, mou_document: mou,
    });
    await delayAiScoring('score_property_verification_task', verification.id);
    const l = await db.selectFrom('listings_listing').select(['id', 'status']).where('id', '=', listing.id).executeTakeFirstOrThrow();
    if (l.status !== 'pending_review') await saveListing(l.id, { status: 'pending_review' }, { updateFields: ['status'] });
    await safeNotify('notifyPropertyVerificationSubmitted', verification);
    await safeNotify('notifyPropertyVerificationReceived', verification);
    return res.status(201).json((await serializeVerifications([verification], req))[0]);
  },
}));

r.path('for-listing/<int:listing_id>/', view({
  async GET(req, res) {
    const pk = pkParam(req.params.listing_id);
    const v = pk === null ? undefined : await db.selectFrom('propertyverifications_propertyverification').selectAll()
      .where('listing_id', '=', pk).where('applicant_id', '=', req.user!.id).orderBy('created_at', 'desc').executeTakeFirst();
    if (!v) return res.status(204).end();
    return (await serializeVerifications([v], req))[0];
  },
}));

r.path('<int:pk>/resubmit/', view({
  async POST(req, res) {
    const pk = pkParam(req.params.pk);
    let v = pk === null ? undefined : await db.selectFrom('propertyverifications_propertyverification').selectAll()
      .where('id', '=', pk).where('applicant_id', '=', req.user!.id).orderBy('created_at', 'desc').executeTakeFirst();
    if (!v) return res.status(404).json({ detail: 'Not found.' });
    if (v.status !== 'correction_requested') return res.status(400).json({ detail: 'This verification is not awaiting correction.' });
    const { data } = await parseRequest(req, res);
    const s = await runSerializer(data, RESUBMIT_FIELDS, { partial: true });
    if (s.errors) return res.status(400).json(s.errors);
    const set: Record<string, unknown> = { ...s.values, updated_at: nowPg() };
    if ('mou_document' in set) set.mou_document = isUpload(set.mou_document) ? await saveUpload(MOU_DIR, set.mou_document.name, set.mou_document.data) : '';
    v = await db.updateTable('propertyverifications_propertyverification').set(set as never).where('id', '=', v.id).returningAll().executeTakeFirstOrThrow();
    try {
      v = await resubmit(v);
    } catch (e) { if (!(e instanceof InvalidTransition)) throw e; }
    await delayAiScoring('score_property_verification_task', v.id);
    return (await serializeVerifications([v], req))[0];
  },
}));

const STAGE_PERMISSION: Record<string, string> = {
  product_support: 'propertyverifications.review_property_product_support',
  compliance: 'propertyverifications.review_property_compliance',
  supervisor: 'propertyverifications.review_property_supervisor',
};
const STAGE_STATUS: Record<string, string> = { product_support: 'submitted', compliance: 'ps_approved', supervisor: 'compliance_approved' };

const hasBackgroundChecksAccess = (req: ApiRequest) => hasPermission(req.user, 'trust_safety.background_checks', 'execute');

r.path('review-queue/', view({
  async GET(req) {
    let stages: string[];
    if (await hasBackgroundChecksAccess(req)) stages = Object.keys(STAGE_PERMISSION);
    else {
      stages = [];
      for (const [stage, perm] of Object.entries(STAGE_PERMISSION)) if (await hasDjangoPerm(req.user, perm)) stages.push(stage);
    }
    if (!stages.length) throw new HttpResponseError(403, { error: 'You are not a reviewer for any stage of this queue.' });
    const rows = await db.selectFrom('propertyverifications_propertyverification').selectAll()
      .where('status', 'in', stages.map((s) => STAGE_STATUS[s]!)).orderBy('created_at').execute();
    return serializeVerifications(rows, req, true);
  },
}));

/** Python float(x) for request values; null → TypeError/ValueError. */
function pyFloatValue(x: unknown): number | null {
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x !== 'string') return null;
  const t = pyStrip(x);
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  if (!/^[+-]?((\d(_?\d)*)?\.?\d(_?\d)*|\d(_?\d)*\.)([eE][+-]?\d(_?\d)*)?$/.test(t)) return null;
  return Number(t.replace(/_/g, ''));
}

r.path('<int:pk>/review/', view({
  async POST(req, res) {
    const pk = pkParam(req.params.pk);
    let v: Verification | undefined = pk === null ? undefined
      : await db.selectFrom('propertyverifications_propertyverification').selectAll().where('id', '=', pk).executeTakeFirst();
    if (!v) throw notFoundFor('PropertyVerification');
    const stage = currentStage(v.status);
    if (stage === null) return res.status(400).json({ error: 'This verification is not awaiting review.' });
    if (!((await hasBackgroundChecksAccess(req)) || (await hasDjangoPerm(req.user, STAGE_PERMISSION[stage]!)))) {
      return res.status(403).json({ error: 'You are not authorized to review this stage.' });
    }
    const { data, files } = await parseRequest(req, res);
    const decision = dataGet(data, 'decision');
    const notes = dataGet(data, 'notes', '');
    if (decision !== null && typeof decision === 'object') throw new TypeError(`unhashable type: '${Array.isArray(decision) ? 'list' : 'dict'}'`);
    if (decision !== APPROVE && decision !== REJECT && decision !== REQUEST_CORRECTION) {
      return res.status(400).json({ error: "decision must be one of ['approve', 'reject', 'request_correction']" });
    }
    if (decision !== APPROVE && !pyStrip(pystr(notes))) {
      return res.status(400).json({ error: 'Notes are required when rejecting or requesting a correction.' });
    }
    const inspection: InspectionData = {};
    const overrides = new Map<number, Record<string, unknown>>();
    let reportUpload: Upload | null = null;
    if (stage === 'compliance') {
      const truthyStr = (x: unknown) => ['true', '1', 'yes'].includes(pystr(x).toLowerCase());
      if (dataHas(data, 'due_diligence_done')) inspection.due_diligence_done = truthyStr(dataGet(data, 'due_diligence_done'));
      const rep = files.get('inspection_report');
      if (rep && rep.length) reportUpload = rep[rep.length - 1]!;
      if (dataHas(data, 'owner_authorization_confirmed')) inspection.owner_authorization_confirmed = truthyStr(dataGet(data, 'owner_authorization_confirmed'));
      const ov: Record<string, unknown> = {};
      for (const field of ['inspection_latitude', 'inspection_longitude'] as const) {
        const raw = dataGet(data, field);
        if (raw === null || raw === undefined || raw === '') continue;
        const f = pyFloatValue(data instanceof QueryDict ? data.get(field) : dataItem(data, field));
        if (f === null) return res.status(400).json({ error: `${field} must be a number.` });
        inspection[field] = floatToDecimalPrec(f, 9);
        ov[field] = floatDecimalRepr(f, 6);
      }
      if (decision === APPROVE) overrides.set(v.id, ov);
    }
    try {
      if (stage === 'product_support') v = await psDecision(v, decision, req.user!, notes);
      else if (stage === 'compliance') {
        if (decision === APPROVE && reportUpload) inspection.inspection_report = await saveUpload('property_verifications/inspections/', reportUpload.name, reportUpload.data);
        v = await complianceDecision(v, decision, req.user!, notes, inspection);
      } else v = await supervisorDecision(v, decision, req.user!, notes);
    } catch (e) {
      if (e instanceof InvalidTransition) return res.status(400).json({ error: e.message });
      throw e;
    }
    await logAdminAction(req, 'property_verification.review', {
      target: auditTarget('PropertyVerification', v.id, await verificationStr(v)), reason: pyTruthy(notes) ? pystr(notes) : '',
      metadata: { decision, stage },
    });
    return (await serializeVerifications([v], req, true, overrides))[0];
  },
}));
