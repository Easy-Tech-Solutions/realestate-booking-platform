// messaging/serializers.py (output side).

import type { Request } from 'express';
import type { Selectable } from 'kysely';
import { db } from '../../db/index.js';
import type { MessagingConversation, MessagingMessage, UsersUser } from '../../db/schema.js';
import { drf } from '../../lib/datetime.js';
import { fileUrl } from '../../lib/drf.js';
import type { ApiRequest } from '../../lib/view.js';
import { fullName } from './pyutil.js';

type UserRow = Selectable<UsersUser>;
type Conv = Selectable<MessagingConversation>;
type Msg = Selectable<MessagingMessage>;

/** users.serializers.ProfileSerializer with `request` in context (absolute image URL). */
export async function serializeProfileCtx(userId: number, req: Request | null) {
  const p = await db.selectFrom('users_profile').selectAll().where('user_id', '=', userId).executeTakeFirst();
  if (!p) return null;
  return { image: fileUrl(req, p.image), bio: p.bio, phone_number: p.phone_number, is_superhost: p.is_superhost, last_seen: drf(p.last_seen) };
}

/** ParticipantSerializer */
export async function serializeParticipant(u: UserRow, req: Request | null) {
  return {
    id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name,
    full_name: fullName(u) || u.email,
    profile: await serializeProfileCtx(u.id, req),
  };
}

/** conversation.participants.all() — same SQL shape as Django (no ORDER BY). */
export async function participantsOf(conversationIds: number[]): Promise<Map<number, UserRow[]>> {
  const out = new Map<number, UserRow[]>();
  if (!conversationIds.length) return out;
  let q = db.selectFrom('users_user')
    .innerJoin('messaging_conversation_participants as p', 'p.user_id', 'users_user.id')
    .selectAll('users_user').select('p.conversation_id as _pcid');
  q = conversationIds.length === 1 ? q.where('p.conversation_id', '=', conversationIds[0]!) : q.where('p.conversation_id', 'in', conversationIds);
  for (const row of await q.execute()) {
    const { _pcid, ...u } = row as UserRow & { _pcid: number };
    const list = out.get(Number(_pcid)) ?? [];
    list.push(u as UserRow);
    out.set(Number(_pcid), list);
  }
  return out;
}

/** _attachments_allowed / get_attachments_allowed */
export async function attachmentsAllowed(conv: Conv): Promise<boolean> {
  if (!conv.listing_id) return false;
  const hit = await db.selectFrom('bookings_booking').select('id')
    .where('listing_id', '=', conv.listing_id)
    .where('status', 'in', ['confirmed', 'completed'])
    .where('customer_id', 'in', db.selectFrom('messaging_conversation_participants').select('user_id').where('conversation_id', '=', conv.id))
    .limit(1).executeTakeFirst();
  return !!hit;
}

/** ConversationSerializer */
export async function serializeConversation(conv: Conv, req: ApiRequest, participants?: UserRow[]) {
  const parts = participants ?? (await participantsOf([conv.id])).get(conv.id) ?? [];
  const last = await db.selectFrom('messaging_message').selectAll().where('conversation_id', '=', conv.id)
    .orderBy('created_at', 'desc').limit(1).executeTakeFirst();
  let lastMessage = null;
  if (last) {
    const sender = await db.selectFrom('users_user').select('email').where('id', '=', last.sender_id).executeTakeFirstOrThrow();
    lastMessage = { id: last.id, content: last.content, sender_email: sender.email, created_at: drf(last.created_at), message_type: last.message_type };
  }
  let unread = 0;
  if (req.user) {
    const { n } = await db.selectFrom('messaging_message').select((eb) => eb.fn.countAll<string>().as('n'))
      .where('conversation_id', '=', conv.id).where('is_read', '=', false).where('sender_id', '!=', req.user.id).executeTakeFirstOrThrow();
    unread = Number(n);
  }
  let listingTitle: string | null = null;
  if (conv.listing_id) {
    const l = await db.selectFrom('listings_listing').select('title').where('id', '=', conv.listing_id).executeTakeFirst();
    listingTitle = l ? l.title : null;
  }
  const out = [];
  for (const u of parts) out.push(await serializeParticipant(u, req));
  return {
    id: conv.id,
    participants: out,
    listing: conv.listing_id,
    listing_title: listingTitle,
    last_message: lastMessage,
    unread_count: unread,
    attachments_allowed: await attachmentsAllowed(conv),
    created_at: drf(conv.created_at),
    updated_at: drf(conv.updated_at),
  };
}

/** MessageSerializer */
export async function serializeMessage(m: Msg, req: Request | null) {
  const sender = await db.selectFrom('users_user').selectAll().where('id', '=', m.sender_id).executeTakeFirstOrThrow();
  const atts = await db.selectFrom('messaging_messageattachment').selectAll().where('message_id', '=', m.id).orderBy('id').execute();
  let replyTo = null;
  if (m.reply_to_id) {
    const r = await db.selectFrom('messaging_message').selectAll().where('id', '=', m.reply_to_id).executeTakeFirst();
    if (r) {
      const rs = await db.selectFrom('users_user').selectAll().where('id', '=', r.sender_id).executeTakeFirstOrThrow();
      replyTo = { id: r.id, content: r.content, sender_name: fullName(rs) || rs.email, message_type: r.message_type };
    }
  }
  return {
    id: m.id,
    conversation: m.conversation_id,
    sender: await serializeParticipant(sender, req),
    content: m.content,
    message_type: m.message_type,
    is_read: m.is_read,
    attachments: atts.map((a) => ({
      id: a.id, file_url: fileUrl(req, a.file), file_name: a.file_name, file_size: a.file_size, file_type: a.file_type, created_at: drf(a.created_at),
    })),
    reply_to: replyTo,
    created_at: drf(m.created_at),
    edited_at: drf(m.edited_at),
  };
}
