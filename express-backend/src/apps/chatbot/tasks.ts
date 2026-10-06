// chatbot/tasks.py — get_chatbot_reply_task on the ai_scoring queue.

import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { defineTask } from '../../lib/jobs.js';
import { logger } from '../../lib/logger.js';
import { buildKnowledgeContext } from './knowledge_base.js';
import { getChatbotReply, ModelUnavailable } from './responder.js';

export const FALLBACK_REPLY = "I'm sorry, I'm not able to answer that right now. Would you like me to connect you with a support agent?";

export async function getChatbotReplyTask(sessionId: string, userMessage: string) {
  const session = await db.selectFrom('chatbot_chatsession').select('id').where('id', '=', sessionId).executeTakeFirst();
  if (!session) return { reply: FALLBACK_REPLY, needs_agent: true, message_id: null };
  const userMsg = await db.insertInto('chatbot_chatmessage').values({
    session_id: sessionId, role: 'user', content: userMessage, suggested_handoff: false, created_at: nowPg(),
  }).returningAll().executeTakeFirstOrThrow();
  const history = await db.selectFrom('chatbot_chatmessage').select(['role', 'content']).where('session_id', '=', sessionId)
    .where('id', '!=', userMsg.id).orderBy('created_at').execute();
  let result: { reply: string; needs_agent: boolean };
  try {
    const knowledge = await buildKnowledgeContext();
    result = await getChatbotReply(knowledge, history, userMessage);
  } catch (exc) {
    if (!(exc instanceof ModelUnavailable)) logger.error({ err: exc }, `chatbot reply failed for session ${sessionId}`);
    result = { reply: FALLBACK_REPLY, needs_agent: true };
  }
  const bot = await db.insertInto('chatbot_chatmessage').values({
    session_id: sessionId, role: 'bot', content: result.reply, suggested_handoff: result.needs_agent, created_at: nowPg(),
  }).returningAll().executeTakeFirstOrThrow();
  await db.updateTable('chatbot_chatsession').set({ updated_at: nowPg() }).where('id', '=', sessionId).execute();
  return { reply: result.reply, needs_agent: result.needs_agent, message_id: bot.id };
}

defineTask('chatbot.tasks.get_chatbot_reply_task', getChatbotReplyTask as never, { queue: 'ai_scoring' });
