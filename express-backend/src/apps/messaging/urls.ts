// messaging — /api/messaging/ (port of messaging/views.py + urls.py).

import type { Response } from 'express';
import { db } from '../../db/index.js';
import { drf, isoformat, nowPg } from '../../lib/datetime.js';
import { HttpResponseError, notFoundFor } from '../../lib/errors.js';
import { apiView, IsAuthenticated, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { notifyMessageViolationRecipient } from '../../domain/notifications.js';
import { addM2M, addParticipants, broadcast, createConversation, createMessage, touchConversation } from '../../domain/messaging.js';
import { CharField, FieldError, FileField, IntegerField, ListField, validate } from './drf.js';
import { inBigintRange, pgMs, pyIntForLookup, pySplitext, pyStrip, pyTruthy, pyStr } from './pyutil.js';
import { scanMessage } from './redaction.js';
import { dget, parseRequest, type Upload } from './request.js';
import { saveUpload } from '../../lib/upload.js';
import { participantsOf, serializeConversation, serializeMessage } from './serializers.js';
import { recordViolationsAndEscalate } from './violations.js';

const MESSAGE_EDIT_WINDOW_MS = 3 * 60 * 1000;

/** <int:...> URL kwarg → id usable in a lookup, or null when it can't match any row (Django 5 overflow → empty). */
export function urlId(v: unknown): number | null {
  const b = BigInt(String(v));
  if (!inBigintRange(b)) return null;
  return Number(b);
}

async function conversationForUser(rawId: unknown, userId: number) {
  const id = urlId(rawId);
  const conv = id === null ? undefined : await db.selectFrom('messaging_conversation').selectAll('messaging_conversation')
    .innerJoin('messaging_conversation_participants as p', 'p.conversation_id', 'messaging_conversation.id')
    .where('messaging_conversation.id', '=', id).where('p.user_id', '=', userId).executeTakeFirst();
  if (!conv) throw notFoundFor('Conversation');
  return conv;
}

function detectFileType(f: Upload): string {
  const ct = f.contentType || '';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('video/')) return 'video';
  const ext = pySplitext(f.name)[1].toLowerCase();
  if (['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx'].includes(ext)) return 'document';
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm'].includes(ext)) return 'video';
  return 'other';
}

const r = djangoRouter('api/messaging/');

// ---- ConversationListView ---------------------------------------------------------------
r.path('conversations/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const uid = req.user!.id;
    const convs = await db.selectFrom('messaging_conversation').selectAll('messaging_conversation')
      .innerJoin('messaging_conversation_participants as p', 'p.conversation_id', 'messaging_conversation.id')
      .where('p.user_id', '=', uid)
      .where(({ not, exists, selectFrom }) => not(exists(selectFrom('messaging_conversation_deleted_by as d').select('d.id')
        .whereRef('d.conversation_id', '=', 'messaging_conversation.id').where('d.user_id', '=', uid))))
      .orderBy('messaging_conversation.updated_at', 'desc').execute();
    const parts = await participantsOf(convs.map((c) => c.id));
    const out = [];
    for (const c of convs) out.push(await serializeConversation(c, req, parts.get(c.id) ?? []));
    return out;
  },
}));

// ---- StartConversationView ---------------------------------------------------------------
r.path('conversations/start/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const { data } = await parseRequest(req, res);
    const v = await validate(data, [
      ['recipient_id', IntegerField()],
      ['listing_id', IntegerField({ required: false, allowNull: true })],
      ['initial_message', CharField({ required: false, allowBlank: true, default: '' })],
    ]);
    if (v.errors) throw new HttpResponseError(400, v.errors);
    const recipientId = v.values.recipient_id as bigint;
    const listingId = (v.values.listing_id ?? null) as bigint | null;
    const initial = pyStrip(String(v.values.initial_message ?? ''));
    const me = req.user!;
    if (recipientId === BigInt(me.id)) {
      return res.status(400).json({ detail: 'You cannot start a conversation with yourself.' });
    }
    const recipient = inBigintRange(recipientId)
      ? await db.selectFrom('users_user').selectAll().where('id', '=', Number(recipientId)).executeTakeFirst() : undefined;
    if (!recipient) throw notFoundFor('User');

    let existing;
    if (listingId === null || inBigintRange(listingId)) {
      let q = db.selectFrom('messaging_conversation').selectAll()
        .where('id', 'in', db.selectFrom('messaging_conversation_participants').select('conversation_id').where('user_id', '=', me.id))
        .where('id', 'in', db.selectFrom('messaging_conversation_participants').select('conversation_id').where('user_id', '=', recipient.id));
      q = listingId === null ? q.where('listing_id', 'is', null) : q.where('listing_id', '=', Number(listingId));
      existing = await q.orderBy('updated_at', 'desc').limit(1).executeTakeFirst();
    }
    if (existing) {
      await db.deleteFrom('messaging_conversation_deleted_by').where('conversation_id', '=', existing.id).where('user_id', 'in', [me.id]).execute();
      return res.status(200).json(await serializeConversation(existing, req));
    }
    const conv = await createConversation(listingId === null ? null : listingId.toString());
    await addParticipants(conv.id, [me.id, recipient.id]);
    if (initial) await createMessage({ conversation_id: conv.id, sender_id: me.id, content: initial, message_type: 'text' });
    return res.status(201).json(await serializeConversation(conv, req));
  },
}));

// ---- DeleteConversationView ----------------------------------------------------------------
r.path('conversations/<int:conversation_id>/', apiView({
  permissions: [IsAuthenticated],
  async DELETE(req, res) {
    const conv = await conversationForUser(req.params.conversation_id, req.user!.id);
    await addM2M('messaging_conversation_deleted_by', conv.id, [req.user!.id]);
    res.status(204).end();
  },
}));

// ---- MessageListView -----------------------------------------------------------------------
r.path('conversations/<int:conversation_id>/messages/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const conv = await conversationForUser(req.params.conversation_id, req.user!.id);
    const msgs = await db.selectFrom('messaging_message').selectAll().where('conversation_id', '=', conv.id).orderBy('created_at').execute();
    const out = [];
    for (const m of msgs) out.push(await serializeMessage(m, req));
    const upd = await db.updateTable('messaging_message').set({ is_read: true })
      .where('conversation_id', '=', conv.id).where('is_read', '=', false).where('sender_id', '!=', req.user!.id).executeTakeFirst();
    if (Number(upd.numUpdatedRows)) {
      await broadcast(conv.id, { type: 'broadcast_read_receipt', conversation_id: conv.id, reader_id: req.user!.id });
    }
    return out;
  },
}));

// ---- SendMessageView -----------------------------------------------------------------------
r.path('conversations/<int:conversation_id>/messages/send/', apiView({
  permissions: [IsAuthenticated],
  async POST(req, res) {
    const me = req.user!;
    const conv = await conversationForUser(req.params.conversation_id, me.id);
    const { data, files } = await parseRequest(req, res);
    const v = await validate(data, [
      ['content', CharField({ required: false, allowBlank: true, default: '' })],
      ['files', ListField(FileField(), { required: false })],
    ], {
      validate(attrs) {
        if (!pyTruthy(attrs.content) && !pyTruthy(attrs.files)) throw new FieldError('A message must have text content or at least one file.');
        return attrs;
      },
    });
    if (v.errors) throw new HttpResponseError(400, v.errors);
    let content = pyStrip(String(v.values.content ?? ''));
    const uploads = files.get('files') ?? [];

    if (uploads.length) {
      const { attachmentsAllowed } = await import('./serializers.js');
      if (!(await attachmentsAllowed(conv))) {
        return res.status(403).json({ detail: 'Attachments are only available after a booking is confirmed.', code: 'attachments_not_allowed' });
      }
    }
    const [redacted, codes] = scanMessage(content);
    content = redacted;
    const msgType = content && uploads.length ? 'text_file' : uploads.length ? 'file' : 'text';

    const replyToRaw = dget(data, 'reply_to_id');
    let replyTo: number | null = null;
    if (pyTruthy(replyToRaw)) {
      const rid = pyIntForLookup(replyToRaw);
      if (inBigintRange(rid)) {
        const m = await db.selectFrom('messaging_message').select('id').where('id', '=', Number(rid)).where('conversation_id', '=', conv.id).executeTakeFirst();
        if (m) replyTo = m.id;
      }
    }

    const message = await createMessage({ conversation_id: conv.id, sender_id: me.id, content, message_type: msgType, reply_to_id: replyTo });

    if (codes.length) {
      const others = await db.selectFrom('users_user')
        .innerJoin('messaging_conversation_participants as p', 'p.user_id', 'users_user.id')
        .selectAll('users_user').where('p.conversation_id', '=', conv.id).where('users_user.id', '!=', me.id).execute();
      await recordViolationsAndEscalate(me, others[0] ?? null, conv.id, codes);
      for (const extra of others.slice(1)) {
        try { await notifyMessageViolationRecipient(extra, me); } catch { /* pass */ }
      }
    }

    let hasAttachments = false;
    for (const f of uploads) {
      const stored = await saveUpload('messaging/attachments/%Y/%m/', f.name, f.buffer, 100);
      await db.insertInto('messaging_messageattachment').values({
        message_id: message.id, file: stored, file_name: f.name, file_size: f.size, file_type: detectFileType(f), created_at: nowPg(),
      }).execute();
      hasAttachments = true;
    }

    await touchConversation(conv.id);
    await db.deleteFrom('messaging_conversation_deleted_by').where('conversation_id', '=', conv.id).execute();

    await broadcast(conv.id, {
      type: 'broadcast_message',
      message_id: message.id,
      content: message.content,
      sender_id: me.id,
      sender_email: me.email,
      conversation_id: conv.id,
      created_at: isoformat(message.created_at),
      message_type: msgType,
      has_attachments: hasAttachments,
    });
    const payload = { ...(await serializeMessage(message, req)), was_redacted: codes.length > 0 };
    return res.status(201).json(payload);
  },
}));

// ---- EditMessageView ------------------------------------------------------------------------
r.path('messages/<int:message_id>/edit/', apiView({
  permissions: [IsAuthenticated],
  async PATCH(req, res: Response) {
    const id = urlId(req.params.message_id);
    const message = id === null ? undefined : await db.selectFrom('messaging_message').selectAll()
      .where('id', '=', id).where('sender_id', '=', req.user!.id).executeTakeFirst();
    if (!message) throw notFoundFor('Message');
    if (Date.now() - pgMs(message.created_at) > MESSAGE_EDIT_WINDOW_MS) {
      return res.status(403).json({ detail: 'Messages can only be edited within 3 minutes of sending.' });
    }
    const { data } = await parseRequest(req, res);
    const raw = dget(data, 'content');
    const val = pyTruthy(raw) ? raw : '';
    if (typeof val !== 'string') throw new TypeError(`'${typeof val}' object has no attribute 'strip'`);
    const newContent = pyStrip(val);
    if (!newContent) return res.status(400).json({ detail: 'Content cannot be empty.' });
    const saved = await db.updateTable('messaging_message').set({ content: newContent, edited_at: nowPg() })
      .where('id', '=', message.id).returningAll().executeTakeFirstOrThrow();
    await broadcast(saved.conversation_id, {
      type: 'broadcast_message_edited',
      message_id: saved.id,
      content: saved.content,
      edited_at: isoformat(saved.edited_at),
      conversation_id: saved.conversation_id,
    });
    return serializeMessage(saved, req);
  },
}));

// ---- UserPresenceView -----------------------------------------------------------------------
r.path('users/<int:user_id>/presence/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const id = urlId(req.params.user_id);
    const target = id === null ? undefined : await db.selectFrom('users_user').select('id').where('id', '=', id).executeTakeFirst();
    if (!target) throw notFoundFor('User');
    const p = await db.selectFrom('users_profile').select('last_seen').where('user_id', '=', target.id).executeTakeFirst();
    const lastSeen = p?.last_seen ?? null;
    const online = lastSeen !== null && Date.now() - pgMs(lastSeen) < 2 * 60 * 1000;
    return { user_id: target.id, online, last_seen: drf(lastSeen) };
  },
}));

// ---- UnreadCountView ------------------------------------------------------------------------
r.path('unread-count/', apiView({
  permissions: [IsAuthenticated],
  async GET(req) {
    const uid = req.user!.id;
    const { n } = await db.selectFrom('messaging_message as m')
      .innerJoin('messaging_conversation_participants as p', 'p.conversation_id', 'm.conversation_id')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('p.user_id', '=', uid).where('m.is_read', '=', false).where('m.sender_id', '!=', uid).executeTakeFirstOrThrow();
    return { unread_count: Number(n) };
  },
}));

export { pyStr };
