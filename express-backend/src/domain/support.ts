// support — functions other apps call (support.sla.sla_deadline_for,
// support.views._create_support_conversation / _get_support_admin, and
// SupportTicket / TicketMessage creation with the model's save() rules).

import { randomInt } from 'node:crypto';
import { db } from '../db/index.js';
import { nowPg } from '../lib/datetime.js';
import { logger } from '../lib/logger.js';
import { addParticipants, createConversation, createMessage } from './messaging.js';
import type { Executor } from './notifications.js';

// ---- support/sla.py ----------------------------------------------------------------------------

export const SLA_WINDOWS_HOURS: Record<string, number> = { urgent: 4, high: 24, medium: 72, low: 168 };

/** sla_deadline_for(priority, created_at) → pg-compatible timestamp text. */
export function slaDeadlineFor(priority: string, createdAt: string): string {
  const hours = SLA_WINDOWS_HOURS[priority] ?? SLA_WINDOWS_HOURS.medium!;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(createdAt)!;
  const base = Date.parse(`${m[1]}T${m[2]}Z`) + hours * 3_600_000;
  const frac = m[3] ? m[3].padEnd(7, '0').slice(0, 7) : '';
  return new Date(base).toISOString().replace(/\.\d{3}Z$/, `${frac}+00:00`);
}

// ---- support.models ----------------------------------------------------------------------------

export const TICKET_CATEGORY_CHOICES: [string, string][] = [
  ['account', 'Account & Profile'], ['booking', 'Booking Issue'], ['payment', 'Payment & Refunds'], ['listing', 'Listing Problem'],
  ['safety', 'Safety Concern'], ['technical', 'Technical Issue'], ['host', 'Host Support'], ['other', 'Other'],
];
export const TICKET_STATUS_CHOICES: [string, string][] = [
  ['open', 'Open'], ['in_progress', 'In Progress'], ['pending_user', 'Pending User Response'], ['resolved', 'Resolved'], ['closed', 'Closed'],
];
export const TICKET_PRIORITY_CHOICES: [string, string][] = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']];

/** _gen_ticket_number(): HK-YYYYMMDD-<6 random digits> */
export function genTicketNumber(): string {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `HK-${d}-${Array.from({ length: 6 }, () => randomInt(10)).join('')}`;
}

export interface NewTicket {
  user_id: number | null; guest_name: string; guest_email: string; category: string; subject: string; description: string; priority?: string;
}

/** SupportTicket.objects.create(...) followed by sla_due_at = sla_deadline_for(...); save(update_fields=['sla_due_at']). */
export async function createTicketWithSla(t: NewTicket, ex: Executor = db) {
  const now = nowPg();
  const ticket = await ex.insertInto('support_supportticket').values({
    ticket_number: genTicketNumber(), user_id: t.user_id, guest_name: t.guest_name, guest_email: t.guest_email,
    category: t.category, subject: t.subject, description: t.description, status: 'open', priority: t.priority ?? 'medium',
    assigned_to_id: null, conversation_id: null, resolved_at: null, created_at: now, updated_at: now, sla_due_at: null,
    escalated_at: null, escalated_by_id: null, escalation_notes: '',
  }).returningAll().executeTakeFirstOrThrow();
  const due = slaDeadlineFor(ticket.priority, ticket.created_at);
  return ex.updateTable('support_supportticket').set({ sla_due_at: due }).where('id', '=', ticket.id).returningAll().executeTakeFirstOrThrow();
}

/** TicketMessage.objects.create(...) */
export async function createTicketMessage(m: { ticket_id: number; sender_id: number | null; sender_name: string; is_staff_reply: boolean; content: string }, ex: Executor = db) {
  return ex.insertInto('support_ticketmessage').values({ ...m, created_at: nowPg() }).returningAll().executeTakeFirstOrThrow();
}

/** _get_support_admin(): first role=admin or is_staff user by id. */
export async function getSupportAdmin(ex: Executor = db) {
  return ex.selectFrom('users_user').selectAll().where((eb) => eb.or([eb('role', '=', 'admin'), eb('is_staff', '=', true)]))
    .orderBy('id').limit(1).executeTakeFirst();
}

/** _create_support_conversation(user, subject, opening) → conversation id or null (errors swallowed). */
export async function createSupportConversation(user: { id: number }, _subject: string, opening: string): Promise<number | null> {
  try {
    const admin = await getSupportAdmin();
    if (!admin || admin.id === user.id) return null;
    const conv = await createConversation(null);
    await addParticipants(conv.id, [user.id, admin.id]);
    await createMessage({ conversation_id: conv.id, sender_id: user.id, content: opening, message_type: 'text' });
    return conv.id;
  } catch (err) {
    logger.warn({ err }, 'support conversation creation failed');
    return null;
  }
}

/** SupportTicket.requester_name / requester_email */
export async function requester(ticket: { user_id: number | null; guest_name: string; guest_email: string }, ex: Executor = db) {
  if (ticket.user_id) {
    const u = await ex.selectFrom('users_user').select(['first_name', 'last_name', 'username', 'email']).where('id', '=', ticket.user_id).executeTakeFirst();
    if (u) {
      const name = `${u.first_name} ${u.last_name}`.replace(/^[\s\x1c-\x1f\x85]+|[\s\x1c-\x1f\x85]+$/gu, '') || u.username;
      return { name, email: u.email };
    }
  }
  return { name: ticket.guest_name, email: ticket.guest_email };
}

