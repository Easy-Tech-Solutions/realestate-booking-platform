// support — /api/support/ (port of support/views.py + urls.py). Function-based
// @api_view views: default parsers (JSON, multipart, form) and UserRateThrottle.

import { qp } from '../../lib/drf.js';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { HttpResponseError, notFoundFor } from '../../lib/errors.js';
import { DEFAULT_FROM_EMAIL, sendMail } from '../../lib/mail.js';
import { AllowAny, apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { hasAnyPermission, hasPermission } from '../../domain/rbac.js';
import { auditTarget, isSuperadminStaff, logAdminAction, requireDepartment } from '../../domain/superadmin.js';
import {
  createSupportConversation, createTicketMessage, createTicketWithSla, requester, slaDeadlineFor,
  TICKET_CATEGORY_CHOICES, TICKET_PRIORITY_CHOICES, TICKET_STATUS_CHOICES,
} from '../../domain/support.js';
import {
  CharField, ChoiceField, DecimalField, EmailField, FieldError, invalid, PrimaryKeyRelatedField, validate,
} from '../messaging/drf.js';
import { pyTruthy, decCmp, inBigintRange, pgDec, pyDecimal, pyDecimalStr, pyDecimalToFixedParts, pyParseInt, pySlice, pyStr, pyStrip, fullName } from '../messaging/pyutil.js';
import { dget, parseRequest } from '../messaging/request.js';
import { saveUpload } from '../../lib/upload.js';
import { urlId } from '../messaging/urls.js';
import {
  CONTACT_CATEGORY_LABELS, serializeClaim, serializeContact, serializeTicketDetail, serializeTicketList, serializeTicketMessage,
} from './serializers.js';

const SUPPORT_EMAIL = 'support@homekonet.com';
const CATEGORY_LABELS = Object.fromEntries(TICKET_CATEGORY_CHOICES);
const PRIORITY_LABELS = Object.fromEntries(TICKET_PRIORITY_CHOICES);

/** _require_support(request) */
async function requireSupport(req: ApiRequest): Promise<boolean> {
  const u = req.user;
  if (!u || !isSuperadminStaff(u)) return false;
  return (await requireDepartment(u, 'support')) || (await hasAnyPermission(u, 'customer_support.tickets'));
}

async function sendSupportEmail(subject: string, body: string) {
  try { await sendMail(subject, body, DEFAULT_FROM_EMAIL, [SUPPORT_EMAIL]); } catch { /* fail_silently */ }
}

const ticketById = async (raw: unknown) => {
  const id = urlId(raw);
  return id === null ? undefined : db.selectFrom('support_supportticket').selectAll().where('id', '=', id).executeTakeFirst();
};

const userLookup = async (pk: bigint) => (await db.selectFrom('users_user').select('id').where('id', '=', Number(pk)).executeTakeFirst()) ?? null;

const r = djangoRouter('api/support/');

// ---- contact_create ---------------------------------------------------------------------------
r.path('contact/', apiView({
  permissions: [AllowAny],
  async POST(req, res) {
    const { data } = await parseRequest(req, res);
    const notBlank = (msg: string) => (v: unknown) => { const s = pyStrip(String(v)); if (!s) invalid(msg); return s; };
    const v = await validate(data, [
      ['name', CharField({ maxLength: 100 }), notBlank('Name cannot be blank.')],
      ['email', EmailField({ maxLength: 254 })],
      ['category', ChoiceField(Object.keys(CONTACT_CATEGORY_LABELS), { required: false })],
      ['subject', CharField({ maxLength: 200 }), notBlank('Subject cannot be blank.')],
      ['message', CharField(), notBlank('Message cannot be blank.')],
    ]);
    if (v.errors) return res.status(400).json(v.errors);
    const d = v.values as Record<string, string>;
    const user = req.user;
    let inquiry = await db.insertInto('support_contactinquiry').values({
      user_id: user ? user.id : null, conversation_id: null, name: d.name!, email: d.email!, category: d.category ?? 'general',
      subject: d.subject!, message: d.message!, is_read: false, created_at: nowPg(),
    }).returningAll().executeTakeFirstOrThrow();
    const label = CONTACT_CATEGORY_LABELS[inquiry.category] ?? inquiry.category;
    await sendSupportEmail(`[Contact] ${inquiry.subject}`,
      `New Contact Inquiry\n-------------------\nFrom: ${inquiry.name} <${inquiry.email}>\nCategory: ${label}\nSubject: ${inquiry.subject}\n\n${inquiry.message}\n`);
    let conversationId: number | null = null;
    if (user) {
      const opening = `[Contact Inquiry] ${inquiry.subject}\n\nCategory: ${label}\n\n${inquiry.message}`;
      const conv = await createSupportConversation(user, inquiry.subject, opening);
      if (conv) {
        inquiry = await db.updateTable('support_contactinquiry').set({ conversation_id: conv }).where('id', '=', inquiry.id).returningAll().executeTakeFirstOrThrow();
        conversationId = conv;
      }
    }
    return res.status(201).json({
      message: 'Your inquiry has been received. We will get back to you shortly.', id: inquiry.id, conversation_id: conversationId,
    });
  },
}));

// ---- ticket_list_create -----------------------------------------------------------------------
r.path('tickets/', apiView({
  permissions: [AllowAny],
  async GET(req, res) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required to list tickets.' });
    let q = db.selectFrom('support_supportticket').selectAll();
    if (!(await requireSupport(req))) q = q.where('user_id', '=', req.user.id);
    const st = req.query.status;
    const status = Array.isArray(st) ? st[st.length - 1] : st;
    if (typeof status === 'string' && status) q = q.where('status', '=', status);
    const rows = await q.orderBy('created_at', 'desc').execute();
    const out = [];
    for (const t of rows) out.push(await serializeTicketList(t));
    return out;
  },
  async POST(req, res) {
    const { data, files } = await parseRequest(req, res);
    const user = req.user;
    const notBlank = (msg: string) => (v: unknown) => { const s = pyStrip(String(v)); if (!s) invalid(msg); return s; };
    const v = await validate(data, [
      ['category', ChoiceField(TICKET_CATEGORY_CHOICES.map((c) => c[0]))],
      ['subject', CharField({ maxLength: 200 }), notBlank('Subject cannot be blank.')],
      ['description', CharField({ minLength: 10 }), notBlank('Description cannot be blank.')],
      ['guest_name', CharField({ maxLength: 100, required: false, allowBlank: true })],
      ['guest_email', EmailField({ required: false, allowBlank: true })],
    ], {
      validate(attrs) {
        if (!user) {
          if (!pyStrip(String(attrs.guest_name ?? ''))) throw new FieldError({ guest_name: 'Name is required for guest submissions.' });
          if (!pyStrip(String(attrs.guest_email ?? ''))) throw new FieldError({ guest_email: 'Email is required for guest submissions.' });
        }
        return attrs;
      },
    });
    if (v.errors) return res.status(400).json(v.errors);
    const d = v.values as Record<string, string | undefined>;
    let ticket = await createTicketWithSla({
      user_id: user ? user.id : null,
      guest_name: user ? '' : d.guest_name ?? '', guest_email: user ? '' : d.guest_email ?? '',
      category: d.category!, subject: d.subject!, description: d.description!,
    });
    const senderName = user ? (fullName(user) || user.username) : ('guest_name' in d ? d.guest_name! : 'Guest');
    await createTicketMessage({ ticket_id: ticket.id, sender_id: user ? user.id : null, sender_name: senderName, is_staff_reply: false, content: d.description! });
    for (const f of files.get('attachments') ?? []) {
      const stored = await saveUpload('support/attachments/', f.name, f.buffer, 100);
      await db.insertInto('support_ticketattachment').values({
        ticket_id: ticket.id, file: stored, filename: f.name, file_size: f.size, content_type: f.contentType || '',
        uploaded_by_id: user ? user.id : null, created_at: nowPg(),
      }).execute();
    }
    const catLabel = CATEGORY_LABELS[ticket.category] ?? ticket.category;
    if (user) {
      const opening = `[${ticket.ticket_number}] ${ticket.subject}\n\nCategory: ${catLabel}\n\n${ticket.description}`;
      const conv = await createSupportConversation(user, ticket.subject, opening);
      if (conv) {
        ticket = await db.updateTable('support_supportticket').set({ conversation_id: conv }).where('id', '=', ticket.id).returningAll().executeTakeFirstOrThrow();
      }
    }
    const rq = await requester(ticket);
    await sendSupportEmail(`[Ticket ${ticket.ticket_number}] ${ticket.subject}`,
      `New Support Ticket: ${ticket.ticket_number}\n----------------------------------------------\nFrom: ${rq.name} <${rq.email}>\n`
      + `Category: ${catLabel}\nSubject: ${ticket.subject}\nPriority: ${PRIORITY_LABELS[ticket.priority] ?? ticket.priority}\n\n${ticket.description}\n`);
    return res.status(201).json(await serializeTicketDetail(ticket, req));
  },
}));

// ---- ticket_detail ------------------------------------------------------------------------------
r.path('tickets/<int:pk>/', apiView({
  permissions: [AllowAny],
  async GET(req, res) {
    const ticket = await ticketById(req.params.pk);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    const isOwner = !!req.user && ticket.user_id === req.user.id;
    if (!isOwner && !(await requireSupport(req))) return res.status(403).json({ error: 'Access denied.' });
    return serializeTicketDetail(ticket, req);
  },
}));

// ---- ticket_add_message ---------------------------------------------------------------------------
r.path('tickets/<int:pk>/messages/', apiView({
  permissions: [AllowAny],
  async POST(req, res) {
    const ticket = await ticketById(req.params.pk);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    const user = req.user;
    const isOwner = !!user && ticket.user_id === user.id;
    const isAdmin = await requireSupport(req);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Access denied.' });
    const { data } = await parseRequest(req, res);
    const v = await validate(data, [
      ['content', CharField({ minLength: 1 }), (x) => { const s = pyStrip(String(x)); if (!s) invalid('Message content cannot be blank.'); return s; }],
    ]);
    if (v.errors) return res.status(400).json(v.errors);
    const senderName = user ? (fullName(user) || user.username) : (ticket.guest_name || 'Guest');
    const message = await createTicketMessage({
      ticket_id: ticket.id, sender_id: user ? user.id : null, sender_name: senderName, is_staff_reply: isAdmin, content: String(v.values.content),
    });
    if ((isAdmin && ticket.status === 'open') || (!(isAdmin && ticket.status === 'open') && isOwner && ticket.status === 'pending_user')) {
      await db.updateTable('support_supportticket').set({ status: 'in_progress', updated_at: nowPg() }).where('id', '=', ticket.id).execute();
    }
    return res.status(201).json(await serializeTicketMessage(message));
  },
}));

// ---- ticket_search --------------------------------------------------------------------------------
r.path('search/', apiView({
  permissions: [AllowAny],
  async GET(req) {
    const raw = req.query.q;
    const q = pyStrip(String((Array.isArray(raw) ? raw[raw.length - 1] : raw) ?? ''));
    if (!q) return [];
    const pat = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await db.selectFrom('support_supportticket').selectAll().where('status', '=', 'resolved')
      .where((eb) => eb.or([
        eb(eb.fn('upper', ['subject']), 'like', eb.fn('upper', [eb.val(pat)])),
        eb(eb.fn('upper', ['description']), 'like', eb.fn('upper', [eb.val(pat)])),
      ]))
      .orderBy('created_at', 'desc').limit(5).execute();
    const { drf } = await import('../../lib/datetime.js');
    return rows.map((t) => ({ id: t.id, ticket_number: t.ticket_number, subject: t.subject, category: t.category, resolved_at: drf(t.resolved_at) }));
  },
}));

// ---- aircover_claims_collection --------------------------------------------------------------------
r.path('aircover-claims/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const uid = req.user!.id;
    const rows = await db.selectFrom('support_aircoverclaim as c')
      .innerJoin('bookings_booking as b', 'b.id', 'c.booking_id')
      .innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .selectAll('c').distinct()
      .where((eb) => eb.or([eb('c.claimant_id', '=', uid), eb('b.customer_id', '=', uid), eb('l.owner_id', '=', uid)]))
      .orderBy('c.created_at', 'desc').execute();
    const out = [];
    for (const c of rows) out.push(await serializeClaim(c));
    return out;
  },
  async POST(req, res) {
    const { data } = await parseRequest(req, res);
    const user = req.user!;
    const bookingLookup = async (pk: bigint) => (await db.selectFrom('bookings_booking as b').innerJoin('listings_listing as l', 'l.id', 'b.listing_id')
      .select(['b.id', 'b.customer_id', 'l.owner_id']).where('b.id', '=', Number(pk)).executeTakeFirst()) ?? null;
    const v = await validate(data, [
      ['booking', PrimaryKeyRelatedField(bookingLookup), (b) => {
        const bk = b as { customer_id: number; owner_id: number };
        if (bk.customer_id !== user.id && bk.owner_id !== user.id) invalid('You were not a party to this booking.');
        return b;
      }],
      ['claim_type', ChoiceField(['property_damage', 'missing_items', 'cleanliness', 'safety', 'other'])],
      ['description', CharField()],
      ['requested_amount', DecimalField(10, 2), (a) => { const s = String(a); if (s.startsWith('-') || !/[1-9]/.test(s)) invalid('Requested amount must be greater than zero.'); return a; }],
    ]);
    if (v.errors) return res.status(400).json(v.errors);
    const d = v.values as { booking: { id: number }; claim_type: string; description: string; requested_amount: string };
    const claim = await db.insertInto('support_aircoverclaim').values({
      booking_id: d.booking.id, claimant_id: user.id, claim_type: d.claim_type, description: d.description,
      requested_amount: d.requested_amount, approved_amount: null, status: 'submitted', reviewed_by_id: null,
      review_notes: '', reviewed_at: null, created_at: nowPg(),
    }).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'aircover_claim.file', {
      target: auditTarget('AirCoverClaim', claim.id, `AirCover claim #${claim.id} on booking #${claim.booking_id} (${claim.status})`),
      reason: pySlice(claim.description, 200),
    });
    return res.status(201).json(await serializeClaim(claim));
  },
}));

// ---- admin_ticket_list --------------------------------------------------------------------------------


r.path('admin/tickets/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireSupport(req))) return res.status(403).json({ error: 'Admin access required.' });
    let q = db.selectFrom('support_supportticket');
    const status = qp(req, 'status'); if (status) q = q.where('status', '=', status);
    const cat = qp(req, 'category'); if (cat) q = q.where('category', '=', cat);
    const pri = qp(req, 'priority'); if (pri) q = q.where('priority', '=', pri);
    const at = qp(req, 'assigned_to');
    if (at) {
      if (at === 'unassigned') q = q.where('assigned_to_id', 'is', null);
      else {
        const n = pyParseInt(at);
        if (n !== null) q = inBigintRange(n) ? q.where('assigned_to_id', '=', Number(n)) : q.where((eb) => eb.val(false));
      }
    }
    const psRaw = qp(req, 'page_size');
    const ps = psRaw === undefined ? 20n : pyParseInt(psRaw);
    if (ps === null) throw new Error(`invalid literal for int() with base 10: '${psRaw}'`);
    const pageSize = Number(ps);
    const { n } = await q.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    const count = Number(n);
    if (pageSize === 0) throw new Error('division by zero');
    const hits = Math.max(1, count);
    const numPages = Math.ceil(hits / pageSize);
    // paginator.page(page_number) with any failure → page(1)
    const pRaw = qp(req, 'page');
    let page = 1;
    if (pRaw !== undefined) {
      const pn = pyParseInt(pRaw);
      if (pn !== null && pn >= 1n && (pn <= BigInt(numPages) || pn === 1n)) page = Number(pn);
    }
    if (pageSize < 0) throw new Error('Negative indexing is not supported.');
    const offset = (page - 1) * pageSize;
    let top = offset + pageSize;
    if (top >= count) top = count;
    const rows = await q.selectAll().orderBy('created_at', 'desc').limit(Math.max(0, top - offset)).offset(offset).execute();
    const results = [];
    for (const t of rows) results.push(await serializeTicketList(t));
    return { count, num_pages: numPages, current_page: page, results };
  },
}));

// ---- admin_ticket_update -----------------------------------------------------------------------------
r.path('admin/tickets/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await requireSupport(req))) return res.status(403).json({ error: 'Admin access required.' });
    const ticket = await ticketById(req.params.pk);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    const { data } = await parseRequest(req, res);
    const v = await validate(data, [
      ['status', ChoiceField(TICKET_STATUS_CHOICES.map((c) => c[0]), { required: false })],
      ['priority', ChoiceField(TICKET_PRIORITY_CHOICES.map((c) => c[0]), { required: false })],
      ['assigned_to', PrimaryKeyRelatedField(userLookup, { required: false, allowNull: true })],
    ], { partial: true });
    if (v.errors) return res.status(400).json(v.errors);
    const d = v.values;
    const upd: Record<string, unknown> = {};
    const newStatus = d.status as string | undefined;
    if (newStatus === 'resolved' && ticket.status !== 'resolved') upd.resolved_at = nowPg();
    else if (newStatus && newStatus !== 'resolved') upd.resolved_at = null;
    const newPriority = d.priority as string | undefined;
    if (newPriority && newPriority !== ticket.priority) upd.sla_due_at = slaDeadlineFor(newPriority, ticket.created_at);
    if ('status' in d) upd.status = d.status;
    if ('priority' in d) upd.priority = d.priority;
    if ('assigned_to' in d) upd.assigned_to_id = d.assigned_to === null ? null : (d.assigned_to as { id: number }).id;
    upd.updated_at = nowPg();
    const saved = await db.updateTable('support_supportticket').set(upd).where('id', '=', ticket.id).returningAll().executeTakeFirstOrThrow();
    return serializeTicketDetail(saved, req);
  },
}));

// ---- admin_ticket_escalate -------------------------------------------------------------------------------
r.path('admin/tickets/<int:pk>/escalate/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await requireSupport(req))) return res.status(403).json({ error: 'Admin access required.' });
    const ticket = await ticketById(req.params.pk);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    const { data } = await parseRequest(req, res);
    const notes = pyStrip(pyStr(dget(data, 'notes', '')));
    const upd: Record<string, unknown> = { escalated_at: nowPg(), escalated_by_id: req.user!.id, escalation_notes: notes, updated_at: nowPg() };
    if (ticket.priority !== 'urgent') { upd.priority = 'urgent'; upd.sla_due_at = slaDeadlineFor('urgent', ticket.created_at); }
    const saved = await db.updateTable('support_supportticket').set(upd).where('id', '=', ticket.id).returningAll().executeTakeFirstOrThrow();
    await logAdminAction(req, 'support_ticket.escalate', { target: auditTarget('SupportTicket', saved.id, `${saved.ticket_number} — ${saved.subject}`), reason: notes });
    return serializeTicketDetail(saved, req);
  },
}));

// ---- admin_contact_list / update ----------------------------------------------------------------------------
r.path('admin/contact/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireSupport(req))) return res.status(403).json({ error: 'Admin access required.' });
    let q = db.selectFrom('support_contactinquiry').selectAll();
    const ir = qp(req, 'is_read');
    if (ir !== undefined) q = q.where('is_read', '=', ['true', '1', 'yes'].includes(ir.toLowerCase()));
    return (await q.orderBy('created_at', 'desc').execute()).map(serializeContact);
  },
}));

r.path('admin/contact/<int:pk>/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res) {
    if (!(await requireSupport(req))) return res.status(403).json({ error: 'Admin access required.' });
    const id = urlId(req.params.pk);
    const inquiry = id === null ? undefined : await db.selectFrom('support_contactinquiry').selectAll().where('id', '=', id).executeTakeFirst();
    if (!inquiry) return res.status(404).json({ error: 'Contact inquiry not found.' });
    const { data } = await parseRequest(req, res);
    const v = await validate(data, [
      ['name', CharField({ maxLength: 100 })],
      ['email', EmailField({ maxLength: 254 })],
      ['category', ChoiceField(Object.keys(CONTACT_CATEGORY_LABELS), { required: false })],
      ['subject', CharField({ maxLength: 200 })],
      ['message', CharField()],
    ], { partial: true });
    if (v.errors) return res.status(400).json(v.errors);
    // serializer.save() → full-row UPDATE (no auto fields); nothing to change when only read-only keys were sent
    const saved = Object.keys(v.values).length
      ? await db.updateTable('support_contactinquiry').set(v.values as Record<string, string>).where('id', '=', inquiry.id).returningAll().executeTakeFirstOrThrow()
      : inquiry;
    return serializeContact(saved);
  },
}));

// ---- admin_stats ----------------------------------------------------------------------------------------------
r.path('admin/stats/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await requireSupport(req))) return res.status(403).json({ error: 'Admin access required.' });
    const count = async (status?: string) => {
      let q = db.selectFrom('support_supportticket').select((eb) => eb.fn.countAll<string>().as('n'));
      if (status) q = q.where('status', '=', status);
      return Number((await q.executeTakeFirstOrThrow()).n);
    };
    const { n: unread } = await db.selectFrom('support_contactinquiry').select((eb) => eb.fn.countAll<string>().as('n')).where('is_read', '=', false).executeTakeFirstOrThrow();
    const open = await db.selectFrom('support_supportticket').select('sla_due_at').where('status', 'not in', ['resolved', 'closed']).execute();
    const { pgMs } = await import('../messaging/pyutil.js');
    return {
      open: await count('open'), in_progress: await count('in_progress'), pending_user: await count('pending_user'),
      resolved: await count('resolved'), closed: await count('closed'), total: await count(),
      unread_contact: Number(unread),
      breached: open.filter((t) => t.sla_due_at && pgMs(t.sla_due_at) < Date.now()).length,
    };
  },
}));

// ---- admin_aircover_claims_list / decide ------------------------------------------------------------------------
r.path('admin/aircover-claims/', apiView({
  permissions: [IsAuthenticated],
  async GET(req, res) {
    if (!(await hasPermission(req.user, 'customer_support.aircover_claims', 'read'))) {
      return res.status(403).json({ error: 'customer_support.aircover_claims access required' });
    }
    let q = db.selectFrom('support_aircoverclaim').selectAll();
    const st = qp(req, 'status'); if (st) q = q.where('status', '=', st);
    const out = [];
    for (const c of await q.orderBy('created_at', 'desc').execute()) out.push(await serializeClaim(c));
    return out;
  },
}));

r.path('admin/aircover-claims/<int:pk>/decide/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    if (!(await hasPermission(req.user, 'customer_support.aircover_claims', 'update'))) {
      return res.status(403).json({ error: 'customer_support.aircover_claims access required' });
    }
    const id = urlId(req.params.pk);
    const claim = id === null ? undefined : await db.selectFrom('support_aircoverclaim').selectAll().where('id', '=', id).executeTakeFirst();
    if (!claim) throw notFoundFor('AirCoverClaim');
    const { data } = await parseRequest(req, res);
    const decision = dget(data, 'status');
    if (decision !== 'approved' && decision !== 'denied') {
      return res.status(400).json({ error: 'status must be "approved" or "denied"' });
    }
    const notesRaw = dget(data, 'notes', '');
    if (notesRaw === null) throw new Error('null value in column "review_notes" violates not-null constraint');
    const notes = pyStr(notesRaw);
    let approved: string | null = claim.approved_amount; // in-memory value (str(Decimal) form for new ones)
    let approvedDb: string | null = claim.approved_amount;
    if (decision === 'approved') {
      const raw = dget(data, 'approved_amount', undefined);
      const s = raw === undefined ? claim.approved_amount === null ? pyDecimalStr(pyDecimal(claim.requested_amount)!) : pyDecimalStr(pyDecimal(claim.requested_amount)!) : pyStr(raw);
      const dv = pyDecimal(s);
      if (!dv) return res.status(400).json({ error: 'approved_amount must be a valid number.' });
      if (dv.special === 'nan' || dv.special === 'snan') throw new Error('[<class \'decimal.InvalidOperation\'>]');
      const reqAmt = pgDec(claim.requested_amount);
      const tooSmall = dv.special === 'inf' ? dv.sign === 1 : decCmp(pyDecimalToFixedParts(dv), { coef: 0n, scale: 0 }) <= 0;
      const tooBig = dv.special === 'inf' ? dv.sign === 0 : decCmp(pyDecimalToFixedParts(dv), reqAmt) > 0;
      if (tooSmall || tooBig) {
        return res.status(400).json({ error: `approved_amount must be between 0 and the requested ${pyDecimalStr(pyDecimal(claim.requested_amount)!)}.` });
      }
      approved = pyDecimalStr(dv);
      const { coef, scale } = pyDecimalToFixedParts(dv);
      const { quantizeStr } = await import('../messaging/pyutil.js');
      approvedDb = quantizeStr(coef, scale, 2);
    }
    const saved = await db.updateTable('support_aircoverclaim').set({
      status: decision, review_notes: notes, reviewed_by_id: req.user!.id, reviewed_at: nowPg(), approved_amount: approvedDb,
    }).where('id', '=', claim.id).returningAll().executeTakeFirstOrThrow();
    const approvedTruthy = approved !== null && !/^-?0*\.?0*(E[+-]\d+)?$/i.test(approved);
    await logAdminAction(req, 'aircover_claim.decide', {
      target: auditTarget('AirCoverClaim', saved.id, `AirCover claim #${saved.id} on booking #${saved.booking_id} (${saved.status})`),
      reason: pyTruthy(notesRaw) ? notes : '',
      metadata: { decision, approved_amount: approvedTruthy ? approved : null },
    });
    return serializeClaim(saved, approved);
  },
}));
