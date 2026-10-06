// messaging.consumers.ChatConsumer — route ^ws/chat/(?P<conversation_id>\d+)/$.
//
// connect → accepted; {"type":"authenticate","token"} → participant check →
// joins chat_<id>, {"type":"authenticated",...}; chat_message / mark_read /
// typing need authentication; group events broadcast_message /
// broadcast_message_edited / broadcast_read_receipt / broadcast_typing.
// Non-object JSON / binary frames / non-string content crash the consumer (1011) like Django.

import { db } from '../../db/index.js';
import { isoformat, nowPg } from '../../lib/datetime.js';
import { decode } from '../../lib/jwt.js';
import { wsRoute } from '../../lib/ws.js';
import {
  AsyncWebsocketConsumer, ConsumerCrash, PyNum, asConsumer, installOriginValidator, notifyMessageViolationRecipient,
  pyJsonLoads, type LayerMessage,
} from '../../domain/notifications.js';
import { createMessage, touchConversation } from '../../domain/messaging.js';
import { fullName, inBigintRange, pyStr, pyStrip } from './pyutil.js';
import { scanMessage } from './redaction.js';
import { recordViolationsAndEscalate } from './violations.js';

type UserRow = Awaited<ReturnType<typeof loadUser>>;
const loadUser = (id: number) => db.selectFrom('users_user').selectAll().where('id', '=', id).executeTakeFirst();

export class ChatConsumer extends AsyncWebsocketConsumer {
  conversationId = '';
  roomGroupName = '';
  user: NonNullable<UserRow> | null = null;

  /** the URL kwarg as a lookup id (null when it overflows bigint → no row matches). */
  private get convId(): number | null {
    const b = BigInt(this.conversationId);
    return inBigintRange(b) ? Number(b) : null;
  }

  override async connect() {
    this.conversationId = this.params.conversation_id!;
    this.roomGroupName = `chat_${this.conversationId}`;
    this.user = null;
    await this.accept();
  }

  override async disconnect(_code: number) {
    if (this.user) await this.updateLastSeen(this.user);
    await this.channelLayer.groupDiscard(this.roomGroupName, this.channelName);
  }

  override async receive(textData?: string, _bytes?: Buffer) {
    if (textData === undefined) throw new ConsumerCrash("receive() got an unexpected keyword argument 'bytes_data'");
    let data: unknown;
    try {
      data = pyJsonLoads(textData);
    } catch {
      await this.sendError('Invalid JSON.');
      return;
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data) || data instanceof PyNum) {
      throw new ConsumerCrash("object has no attribute 'get'");
    }
    const d = data as Record<string, unknown>;
    const msgType = d.type;
    if (msgType === 'authenticate') await this.handleAuthenticate(d);
    else if (msgType === 'chat_message' || msgType === 'mark_read' || msgType === 'typing') {
      if (!this.user) { await this.sendError('Not authenticated.'); return; }
      if (msgType === 'chat_message') await this.handleChatMessage(d);
      else if (msgType === 'mark_read') await this.handleMarkRead();
      else await this.handleTyping();
    } else {
      await this.sendError(`Unknown message type: ${msgType === undefined ? 'None' : pyStr(msgType)}`);
    }
  }

  private async handleAuthenticate(data: Record<string, unknown>) {
    const user = await this.getUserFromToken('token' in data ? data.token : '');
    if (!user) {
      await this.sendError('Invalid or expired token.');
      await this.close();
      return;
    }
    const cid = this.convId;
    const part = cid === null ? undefined : await db.selectFrom('messaging_conversation_participants').select('id')
      .where('conversation_id', '=', cid).where('user_id', '=', user.id).executeTakeFirst();
    if (!part) {
      await this.sendError('You are not a participant in this conversation.');
      await this.close();
      return;
    }
    this.user = user;
    await this.updateLastSeen(user);
    await this.channelLayer.groupAdd(this.roomGroupName, this.channelName);
    await this.sendJson({ type: 'authenticated', user_id: user.id, email: user.email });
  }

  private async handleChatMessage(data: Record<string, unknown>) {
    const raw = 'content' in data ? data.content : '';
    if (typeof raw !== 'string') throw new ConsumerCrash("object has no attribute 'strip'");
    let content = pyStrip(raw);
    if (!content) { await this.sendError('Message content cannot be empty.'); return; }
    const [redacted, codes] = scanMessage(content);
    content = redacted;
    const user = this.user!;
    const cid = this.convId!;
    const conv = await db.selectFrom('messaging_conversation').select('id').where('id', '=', cid).executeTakeFirst();
    if (!conv) throw new ConsumerCrash('Conversation matching query does not exist.');
    const msg = await createMessage({ conversation_id: cid, sender_id: user.id, content, message_type: 'text' });
    await touchConversation(cid);
    if (codes.length) {
      const others = await db.selectFrom('users_user')
        .innerJoin('messaging_conversation_participants as p', 'p.user_id', 'users_user.id')
        .selectAll('users_user').where('p.conversation_id', '=', cid).where('users_user.id', '!=', user.id).execute();
      await recordViolationsAndEscalate(user, others[0] ?? null, cid, codes);
      for (const extra of others.slice(1)) {
        try { await notifyMessageViolationRecipient(extra, user); } catch { /* pass */ }
      }
    }
    await this.channelLayer.groupSend(this.roomGroupName, {
      type: 'broadcast_message',
      message_id: msg.id,
      content: msg.content,
      sender_id: user.id,
      sender_email: user.email,
      conversation_id: Number(this.conversationId),
      created_at: isoformat(msg.created_at),
      message_type: 'text',
      has_attachments: false,
    });
  }

  private async handleTyping() {
    const u = this.user!;
    await this.channelLayer.groupSend(this.roomGroupName, {
      type: 'broadcast_typing', user_id: u.id, user_name: fullName(u) || u.email, conversation_id: Number(this.conversationId),
    });
  }

  private async handleMarkRead() {
    const cid = this.convId;
    let updated = 0;
    if (cid !== null) {
      const r = await db.updateTable('messaging_message').set({ is_read: true })
        .where('conversation_id', '=', cid).where('is_read', '=', false).where('sender_id', '!=', this.user!.id).executeTakeFirst();
      updated = Number(r.numUpdatedRows);
    }
    await this.sendJson({ type: 'messages_marked_read' });
    if (updated) {
      await this.channelLayer.groupSend(this.roomGroupName, {
        type: 'broadcast_read_receipt', conversation_id: Number(this.conversationId), reader_id: this.user!.id,
      });
    }
  }

  // ---- group handlers ---------------------------------------------------------------------
  private need(e: LayerMessage, k: string): unknown {
    if (!(k in e)) throw new ConsumerCrash(`KeyError: '${k}'`);
    return e[k];
  }

  async broadcast_message(e: LayerMessage) {
    await this.sendJson({
      type: 'chat_message',
      message_id: this.need(e, 'message_id'),
      content: this.need(e, 'content'),
      sender_id: this.need(e, 'sender_id'),
      sender_email: this.need(e, 'sender_email'),
      conversation_id: this.need(e, 'conversation_id'),
      created_at: this.need(e, 'created_at'),
      message_type: 'message_type' in e ? e.message_type : 'text',
      has_attachments: 'has_attachments' in e ? e.has_attachments : false,
    });
  }

  async broadcast_message_edited(e: LayerMessage) {
    await this.sendJson({
      type: 'message_edited',
      message_id: this.need(e, 'message_id'),
      content: this.need(e, 'content'),
      edited_at: this.need(e, 'edited_at'),
      conversation_id: this.need(e, 'conversation_id'),
    });
  }

  async broadcast_read_receipt(e: LayerMessage) {
    await this.sendJson({ type: 'read_receipt', conversation_id: this.need(e, 'conversation_id'), reader_id: this.need(e, 'reader_id') });
  }

  async broadcast_typing(e: LayerMessage) {
    if (this.user && this.need(e, 'user_id') === this.user.id) return;
    await this.sendJson({
      type: 'typing', user_id: this.need(e, 'user_id'), user_name: this.need(e, 'user_name'), conversation_id: this.need(e, 'conversation_id'),
    });
  }

  // ---- helpers -------------------------------------------------------------------------------
  private async getUserFromToken(token: unknown) {
    if (typeof token !== 'string') return null;
    let payload;
    try {
      payload = decode(token, 'access');
    } catch {
      return null;
    }
    if (payload.user_id === undefined) return null;
    const id = Number(payload.user_id);
    if (!Number.isSafeInteger(id)) throw new ConsumerCrash(`Field 'id' expected a number but got ${String(payload.user_id)}`);
    return (await loadUser(id)) ?? null;
  }

  private async updateLastSeen(user: { id: number }) {
    try {
      await db.updateTable('users_profile').set({ last_seen: nowPg() }).where('user_id', '=', user.id).execute();
    } catch { /* pass */ }
  }

  private async sendError(message: string) {
    await this.sendJson({ type: 'error', message });
  }
}

installOriginValidator();
wsRoute('^ws/chat/(?<conversation_id>\\d+)/$', asConsumer(ChatConsumer));
