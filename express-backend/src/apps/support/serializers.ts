// support/serializers.py (output side).

import type { Request } from 'express';
import type { Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { SupportAircoverclaim, SupportContactinquiry, SupportSupportticket, SupportTicketmessage } from '../../db/schema.js';
import { drf } from '../../lib/datetime.js';
import { fileUrl } from '../../lib/drf.js';
import { requester } from '../../domain/support.js';
import { pgDec, pgMs, pyDecimal, pyDecimalToFixedParts, quantizeStr, fullName } from '../messaging/pyutil.js';

type Ticket = Selectable<SupportSupportticket>;

export const CONTACT_CATEGORY_LABELS: Record<string, string> = {
  general: 'General Inquiry', booking: 'Booking Help', payment: 'Payment Issue', listing: 'Listing Question', partnership: 'Partnership', other: 'Other',
};
export const CLAIM_TYPE_LABELS: Record<string, string> = {
  property_damage: 'Property Damage', missing_items: 'Missing Items', cleanliness: 'Cleanliness', safety: 'Safety Issue', other: 'Other',
};
export const CLAIM_STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted', under_review: 'Under Review', approved: 'Approved', denied: 'Denied', paid: 'Paid',
};

export function serializeContact(c: Selectable<SupportContactinquiry>) {
  return { id: c.id, name: c.name, email: c.email, category: c.category, subject: c.subject, message: c.message, is_read: c.is_read, created_at: drf(c.created_at) };
}

async function userName(id: number | null): Promise<string | null> {
  if (!id) return null;
  const u = await db.selectFrom('users_user').select(['first_name', 'last_name', 'username']).where('id', '=', id).executeTakeFirst();
  if (!u) return null;
  return fullName(u) || u.username;
}

async function username(id: number | null): Promise<string | null> {
  if (!id) return null;
  const u = await db.selectFrom('users_user').select('username').where('id', '=', id).executeTakeFirst();
  return u ? u.username : null;
}

const isBreached = (t: Ticket) => !!(t.sla_due_at && !['resolved', 'closed'].includes(t.status) && pgMs(t.sla_due_at) < Date.now());

export async function serializeTicketList(t: Ticket) {
  const req = await requester(t);
  const { n } = await db.selectFrom('support_ticketmessage').select((eb) => eb.fn.countAll<string>().as('n')).where('ticket_id', '=', t.id).executeTakeFirstOrThrow();
  return {
    id: t.id, ticket_number: t.ticket_number, category: t.category, subject: t.subject, status: t.status, priority: t.priority,
    requester_name: req.name, requester_email: req.email, assigned_to: t.assigned_to_id, assigned_to_name: await userName(t.assigned_to_id),
    message_count: Number(n), sla_due_at: drf(t.sla_due_at), is_breached: isBreached(t),
    escalated_at: drf(t.escalated_at), escalated_by_username: await username(t.escalated_by_id), escalation_notes: t.escalation_notes,
    resolved_at: drf(t.resolved_at), created_at: drf(t.created_at), updated_at: drf(t.updated_at),
  };
}

export async function serializeTicketMessage(m: Selectable<SupportTicketmessage>) {
  let display: string;
  if (m.sender_id) display = (await userName(m.sender_id)) ?? (m.sender_name || 'Guest');
  else display = m.sender_name || 'Guest';
  return {
    id: m.id, ticket: m.ticket_id, sender: m.sender_id, sender_display: display, sender_name: m.sender_name,
    is_staff_reply: m.is_staff_reply, content: m.content, created_at: drf(m.created_at),
  };
}

export async function serializeTicketDetail(t: Ticket, req: Request | null) {
  const r = await requester(t);
  const msgs = await db.selectFrom('support_ticketmessage').selectAll().where('ticket_id', '=', t.id).orderBy('created_at').execute();
  const atts = await db.selectFrom('support_ticketattachment').selectAll().where('ticket_id', '=', t.id).orderBy('id').execute();
  const messages = [];
  for (const m of msgs) messages.push(await serializeTicketMessage(m));
  return {
    id: t.id, ticket_number: t.ticket_number, user: t.user_id, guest_name: t.guest_name, guest_email: t.guest_email,
    category: t.category, subject: t.subject, description: t.description, status: t.status, priority: t.priority,
    requester_name: r.name, requester_email: r.email,
    assigned_to: t.assigned_to_id, assigned_to_name: await userName(t.assigned_to_id),
    messages,
    attachments: atts.map((a) => ({
      id: a.id, ticket: a.ticket_id, file: fileUrl(req, a.file), file_url: a.file ? fileUrl(req, a.file) : null, filename: a.filename,
      file_size: a.file_size, content_type: a.content_type, uploaded_by: a.uploaded_by_id, created_at: drf(a.created_at),
    })),
    conversation_id: t.conversation_id || null,
    sla_due_at: drf(t.sla_due_at), is_breached: isBreached(t),
    escalated_at: drf(t.escalated_at), escalated_by_username: await username(t.escalated_by_id), escalation_notes: t.escalation_notes,
    resolved_at: drf(t.resolved_at), created_at: drf(t.created_at), updated_at: drf(t.updated_at),
  };
}

/** DecimalField(max_digits=10, decimal_places=2).to_representation of a raw value (DB text or Python Decimal str). */
export function dec2(v: string | null): string | null {
  if (v === null) return null;
  const d = pyDecimal(v)!;
  const { coef, scale } = pyDecimalToFixedParts(d);
  return quantizeStr(coef, scale, 2);
}

export async function serializeClaim(c: Selectable<SupportAircoverclaim>, approvedOverride?: string | null) {
  const b = await db.selectFrom('bookings_booking').select('listing_id').where('id', '=', c.booking_id).executeTakeFirstOrThrow();
  const l = await db.selectFrom('listings_listing').select('title').where('id', '=', b.listing_id).executeTakeFirstOrThrow();
  return {
    id: c.id, booking: c.booking_id, listing_title: l.title, claimant: c.claimant_id, claimant_username: await username(c.claimant_id),
    claim_type: c.claim_type, claim_type_display: CLAIM_TYPE_LABELS[c.claim_type] ?? c.claim_type, description: c.description,
    requested_amount: dec2(c.requested_amount), approved_amount: dec2(approvedOverride !== undefined ? approvedOverride : c.approved_amount),
    status: c.status, status_display: CLAIM_STATUS_LABELS[c.status] ?? c.status, reviewed_by: c.reviewed_by_id,
    reviewed_by_username: await username(c.reviewed_by_id), review_notes: c.review_notes, reviewed_at: drf(c.reviewed_at), created_at: drf(c.created_at),
  };
}

export { pgDec };
