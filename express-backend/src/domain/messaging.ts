// messaging — model behaviour other apps call (support / chatbot create support
// conversations; bookings looks up conversations). Port of the pieces of
// messaging.models + the Message post_save signal + views._broadcast.
//
//   const conv = await createConversation(null);
//   await addParticipants(conv.id, [user.id, admin.id]);   // M2M add() row order like Django
//   await createMessage({ conversation_id: conv.id, sender_id: user.id, content, message_type: 'text' });

import { db } from '../db/index.js';
import { nowPg } from '../lib/datetime.js';
import { logger } from '../lib/logger.js';
import { channelLayer, messagePostSave, type Executor, type LayerMessage } from './notifications.js';
import { pySetOrder } from '../apps/messaging/pyutil.js';

export { scanMessage, detectRestrictedPhrases, REDACTION_MARKER } from '../apps/messaging/redaction.js';
export { recordViolationsAndEscalate } from '../apps/messaging/violations.js';

/** Conversation.objects.create(listing_id=...) */
export async function createConversation(listingId: number | string | null, ex: Executor = db) {
  const now = nowPg();
  return ex.insertInto('messaging_conversation')
    .values({ listing_id: listingId as number | null, created_at: now, updated_at: now })
    .returningAll().executeTakeFirstOrThrow();
}

/**
 * conversation.participants.add(*users) / deleted_by.add(...): one bulk INSERT …
 * ON CONFLICT DO NOTHING in Python-set order (Django's fast-add path).
 */
export async function addM2M(table: 'messaging_conversation_participants' | 'messaging_conversation_deleted_by', conversationId: number, userIds: number[], ex: Executor = db) {
  const ids = pySetOrder(userIds);
  if (!ids.length) return;
  await ex.insertInto(table).values(ids.map((user_id) => ({ conversation_id: conversationId, user_id })))
    .onConflict((oc) => oc.doNothing()).execute();
}

export const addParticipants = (conversationId: number, userIds: number[], ex: Executor = db) =>
  addM2M('messaging_conversation_participants', conversationId, userIds, ex);

/** conversation.save(update_fields=['updated_at']) */
export async function touchConversation(conversationId: number, ex: Executor = db) {
  await ex.updateTable('messaging_conversation').set({ updated_at: nowPg() }).where('id', '=', conversationId).execute();
}

export interface NewMessage {
  conversation_id: number; sender_id: number; content: string; message_type: string; reply_to_id?: number | null;
}

/** Message.objects.create(...) + post_save (notify_new_message). */
export async function createMessage(m: NewMessage, ex: Executor = db) {
  const msg = await ex.insertInto('messaging_message').values({
    conversation_id: m.conversation_id, sender_id: m.sender_id, content: m.content, reply_to_id: m.reply_to_id ?? null,
    message_type: m.message_type, is_read: false, edited_at: null, created_at: nowPg(), updated_at: nowPg(),
  }).returningAll().executeTakeFirstOrThrow();
  await messagePostSave(msg, { created: true }, ex);
  return msg;
}

/** views._broadcast: group_send to chat_<id>, failures swallowed. */
export async function broadcast(conversationId: number | string, payload: LayerMessage) {
  try {
    await channelLayer.groupSend(`chat_${conversationId}`, payload);
  } catch (err) {
    logger.warn({ err }, 'chat broadcast failed');
  }
}
