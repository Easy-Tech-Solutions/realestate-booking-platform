// agents — /api/agents/ (port of agents/views.py + urls.py).

import { db } from '../../db/index.js';
import { isoformat, nowPg } from '../../lib/datetime.js';
import { delay } from '../../lib/jobs.js';
import { notFoundFor } from '../../lib/errors.js';
import { IsAuthenticated, negotiatedView, type ApiRequest, type User } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { hasPermission } from '../../domain/rbac.js';
import { auditTarget, logAdminAction } from '../../domain/superadmin.js';
import { isApprovedAgent } from '../../domain/users.js';
import {
  notifyAgentApplicationReceived, notifyAgentApplicationSubmitted, notifyPropertyVerificationReceived, notifyPropertyVerificationSubmitted,
} from '../../domain/notifications.js';
import { Dec } from '../notifications/decimal.js';
import { boolField, charField, dget, FieldInvalid, fileField, requestData, runFields, strictStrip, type Spec } from '../bookings/drf.js';
import { lookupId, pyStr, pyStrip, pyTruthy } from '../bookings/py.js';
import { saveUpload } from '../../lib/upload.js';
import { createListing, LISTING_FIELDS, listingValidate, saveListing } from '../../domain/listings.js';
import { createVerification, serializeVerifications } from '../../domain/propertyverifications.js';
import { dataGet, parseRequest, pystr, type Upload } from '../listings/drf.js';
import { runSerializer } from '../../domain/listings.js';
import { getOpsAccount } from './ops.js';
import { serializeApplication } from './serializers.js';
import { ACTIVE_STATUSES, AGENT_AGREEMENT_VERSION, hasPerm, InvalidTransition, STAGE_FOR_STATUS, stageDecision } from './services.js';

const r = djangoRouter('api/agents/');
const userOf = (req: ApiRequest) => req.user as User;

// ---- applications ---------------------------------------------------------------------------------

const APPLICATION_SPEC = (): Spec => {
  const accepted = boolField();
  accepted.validators = [(v) => { if (!v) throw new FieldInvalid(['You must agree to the Agent Agreement to apply.']); }];
  return {
    full_name: charField({ maxLength: 255 }),
    address: charField({ maxLength: 500 }),
    phone: charField({ maxLength: 30 }),
    id_document: fileField({ image: true }),
    agreement_accepted: accepted,
  };
};

r.path('applications/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    const { errors, values } = await runFields(await requestData(req, res), APPLICATION_SPEC());
    if (errors) return res.status(400).json(errors);
    const active = await db.selectFrom('agents_agentapplication').select('id').where('applicant_id', '=', user.id)
      .where('status', 'in', ACTIVE_STATUSES).executeTakeFirst();
    if (active) return res.status(400).json({ non_field_errors: ['You already have an agent application under review.'] });
    const file = values.id_document as Express.Multer.File;
    const name = await saveUpload('agent_applications/ids/', file.originalname, file.buffer);
    const now = nowPg();
    const application = await db.insertInto('agents_agentapplication').values({
      applicant_id: user.id, full_name: values.full_name as string, address: values.address as string, phone: values.phone as string,
      id_document: name, agreement_version: AGENT_AGREEMENT_VERSION, agreement_accepted_at: now, status: 'submitted',
      ps_reviewed_by_id: null, ps_reviewed_at: null, compliance_reviewed_by_id: null, compliance_reviewed_at: null,
      supervisor_reviewed_by_id: null, supervisor_reviewed_at: null, declined_stage: '', decline_reason: '', created_at: now, updated_at: now,
    }).returningAll().executeTakeFirstOrThrow();
    try {
      await notifyAgentApplicationSubmitted(application);
      await notifyAgentApplicationReceived(application);
    } catch { /* pass */ }
    return res.status(201).json(await serializeApplication(application, req));
  },
}));

r.path('applications/me/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const user = userOf(req);
    const a = await db.selectFrom('agents_agentapplication').selectAll().where('applicant_id', '=', user.id).orderBy('created_at', 'desc').executeTakeFirst();
    return { is_agent: await isApprovedAgent(user.id), application: a ? await serializeApplication(a, req) : null };
  },
}));

const STAGE_PERMISSION: Record<string, string> = {
  product_support: 'agents.review_agent_product_support',
  compliance: 'agents.review_agent_compliance',
  supervisor: 'agents.review_agent_supervisor',
};
const STAGE_STATUS: Record<string, string> = { product_support: 'submitted', compliance: 'ps_approved', supervisor: 'compliance_approved' };

const backgroundChecks = (user: User) => hasPermission(user, 'trust_safety.background_checks', 'execute');

async function reviewableStages(user: User): Promise<string[]> {
  if (await backgroundChecks(user)) return Object.keys(STAGE_PERMISSION);
  const out: string[] = [];
  for (const [stage, perm] of Object.entries(STAGE_PERMISSION)) if (await hasPerm(user, perm)) out.push(stage);
  return out;
}

r.path('applications/review-queue/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    const stages = await reviewableStages(userOf(req));
    if (!stages.length) return res.status(403).json({ error: 'You are not a reviewer for any stage of this queue.' });
    const rows = await db.selectFrom('agents_agentapplication').selectAll().where('status', 'in', stages.map((s) => STAGE_STATUS[s]!))
      .orderBy('created_at').execute();
    const out = [];
    for (const a of rows) out.push(await serializeApplication(a, req));
    return out;
  },
}));

r.path('applications/<int:pk>/review/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    const id = lookupId(req.params.pk);
    const application = id === null ? undefined : await db.selectFrom('agents_agentapplication').selectAll().where('id', '=', id).executeTakeFirst();
    if (!application) throw notFoundFor('AgentApplication');
    const stage = STAGE_FOR_STATUS[application.status];
    if (!stage) return res.status(400).json({ error: 'This application is not awaiting review.' });
    if (!((await backgroundChecks(user)) || (await hasPerm(user, STAGE_PERMISSION[stage]!)))) {
      return res.status(403).json({ error: 'You are not authorized to review this stage.' });
    }
    const data = (await requestData(req, res)).data;
    const approve = pyTruthy(dget(data, 'approve'));
    const reason = dget(data, 'reason', '');
    if (!approve && !pyStrip(pyStr(reason))) return res.status(400).json({ error: 'A reason is required when declining.' });
    try {
      await stageDecision(stage as 'product_support', application, approve, user, reason);
    } catch (e) {
      if (e instanceof InvalidTransition) return res.status(400).json({ error: e.message });
      throw e;
    }
    const applicant = await db.selectFrom('users_user').select('username').where('id', '=', application.applicant_id).executeTakeFirstOrThrow();
    await logAdminAction(req, 'agent_application.review', {
      target: auditTarget('AgentApplication', application.id, `Agent application #${application.id} — ${applicant.username} (${application.status})`),
      reason: pyTruthy(reason) ? pyStr(reason) : '',
      metadata: { approved: approve, stage },
    });
    return serializeApplication(application, req);
  },
}));

// ---- dashboard -------------------------------------------------------------------------------------

r.path('dashboard/', negotiatedView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const user = userOf(req);
    const listings = await db.selectFrom('listings_listing as l')
      .leftJoin('propertyverifications_propertyverification as v', 'v.listing_id', 'l.id')
      .select(['l.id', 'l.title', 'l.status', 'l.created_at', 'v.status as vstatus'])
      .where('l.sourced_by_agent_id', '=', user.id).orderBy('l.created_at', 'desc').execute();
    const commissions = await db.selectFrom('agents_agentcommission as c').leftJoin('listings_listing as l', 'l.id', 'c.listing_id')
      .select(['c.id', 'c.booking_id', 'c.amount', 'c.currency', 'c.status', 'c.created_at', 'c.listing_id', 'l.title'])
      .where('c.agent_id', '=', user.id).orderBy('c.created_at', 'desc').execute();
    const sum = (status: string) => commissions.filter((c) => c.status === status).reduce((a, c) => a.add(c.amount), Dec.from('0'));
    const pending = sum('pending');
    const paid = sum('paid');
    const bookings = await db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .select((eb) => eb.fn.countAll<number>().as('n')).where('l.sourced_by_agent_id', '=', user.id).executeTakeFirstOrThrow();
    return {
      is_agent: await isApprovedAgent(user.id),
      summary: {
        properties_sourced: listings.length,
        published: listings.filter((l) => l.status === 'published').length,
        in_review: listings.filter((l) => l.status === 'pending_review').length,
        total_bookings: Number(bookings.n),
        commission_pending: pending.fixed(2),
        commission_paid: paid.fixed(2),
        commission_total: pending.add(paid).fixed(2),
      },
      sourced_properties: listings.map((l) => ({
        id: l.id, title: l.title, listing_status: l.status, verification_status: l.vstatus ?? null, created_at: isoformat(l.created_at),
      })),
      commissions: commissions.slice(0, 50).map((c) => ({
        id: c.id, booking_id: c.booking_id, listing_title: c.listing_id !== null ? c.title : null,
        amount: Dec.from(c.amount).fixed(2), currency: c.currency, status: c.status, created_at: isoformat(c.created_at),
      })),
    };
  },
}));

// ---- list-property ---------------------------------------------------------------------------------

/** (request.data.get(k) or '').strip() */
const field = (data: unknown, k: string) => {
  const v = dataGet(data, k);
  return strictStrip(pyTruthy(v) ? v : '');
};

r.path('list-property/', negotiatedView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const user = userOf(req);
    if (!(await isApprovedAgent(user.id))) return res.status(403).json({ error: 'You must be an approved agent to source properties.' });
    // @parser_classes([MultiPartParser, FormParser, JSONParser]); ListingSerializer is the listings app's.
    const { data, files } = await parseRequest(req, res, ['multipart', 'form', 'json']);
    const ownerName = field(data, 'owner_name');
    const ownerPhone = field(data, 'owner_phone');
    const ownerPayout = field(data, 'owner_payout_number');
    const consent = ['true', '1', 'yes', 'on'].includes(pystr(dataGet(data, 'owner_consent', '')).toLowerCase());
    const errors: Record<string, string> = {};
    if (!ownerName) errors.owner_name = 'Property owner name is required.';
    if (!ownerPhone) errors.owner_phone = "Owner's phone number is required.";
    if (!ownerPayout) errors.owner_payout_number = "Owner's payout (MoMo) number is required.";
    if (!consent) errors.owner_consent = 'You must attest that the owner consented to this listing.';
    if (Object.keys(errors).length) return res.status(400).json(errors);

    const v = await runSerializer(data, LISTING_FIELDS, { validate: listingValidate(null) });
    if (v.errors) return res.status(400).json(v.errors);
    const ops = await getOpsAccount();
    let listing = await createListing(v.values, { owner_id: ops.id, status: 'pending_review', is_available: false });
    const agentFields = {
      sourced_by_agent_id: user.id, agent_owner_name: ownerName, agent_owner_phone: ownerPhone, agent_owner_email: field(data, 'owner_email'),
      agent_owner_payout_number: ownerPayout, agent_owner_payout_network: field(data, 'owner_payout_network'),
    };
    listing = await saveListing(listing.id, agentFields, { updateFields: Object.keys(agentFields) });

    // ListingImage.objects.create(listing=listing, image=img, order=i)
    const gallery: Upload[] = files.get('gallery_images') ?? [];
    for (const [i, img] of gallery.slice(0, 10).entries()) {
      const name = await saveUpload('listings/gallery/', img.name, img.data);
      await db.insertInto('listings_listingimage').values({ listing_id: listing.id, image: name, caption: '', order: i, created_at: nowPg() }).execute();
    }

    const orStr = (k: string) => { const x = dataGet(data, k); return pyTruthy(x) ? pystr(x) : ''; };
    const verification = await createVerification({
      listing_id: listing.id, applicant_id: user.id, ownership_type: 'agent', owner_name: ownerName,
      property_location: listing.address || orStr('property_location'),
      deed_volume_number: orStr('deed_volume_number'), page_number: orStr('page_number'),
    });
    try { await delay('aiscoring.tasks.score_property_verification_task', [verification.id]); } catch { /* pass */ }
    try {
      await notifyPropertyVerificationSubmitted(verification);
      await notifyPropertyVerificationReceived(verification);
    } catch { /* pass */ }
    return res.status(201).json((await serializeVerifications([verification], req))[0]);
  },
}));
