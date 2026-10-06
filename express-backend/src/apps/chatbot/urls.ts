// chatbot — /api/chatbot/ (port of chatbot/views.py + urls.py).
//
// chat/ enqueues chatbot.tasks.get_chatbot_reply_task on the ai_scoring queue
// (task id = BullMQ job id, a uuid4 like Celery's); status/<task_id>/ maps the
// job state onto Celery's AsyncResult states (completed → SUCCESS, failed →
// FAILURE, anything else incl. unknown ids → PENDING).

import { randomUUID } from 'node:crypto';
import { Job } from 'bullmq';
import { db } from '../../db/index.js';
import { nowPg } from '../../lib/datetime.js';
import { delay, queue } from '../../lib/jobs.js';
import { anonRateThrottle } from '../../lib/throttle.js';
import { AllowAny, apiView, type ApiRequest } from '../../lib/view.js';
import { djangoRouter } from '../../routes/registry.js';
import { createSupportConversation, createTicketMessage, createTicketWithSla } from '../../domain/support.js';
import { fullName, pyLen, pySlice, pyStr, pyStrip, pyTruthy, pyUuid } from '../messaging/pyutil.js';
import { dget, parseRequest } from '../messaging/request.js';
import { FALLBACK_REPLY } from './tasks.js';

/** ChatSession.objects.get(id=...) — invalid UUIDs raise ValidationError (→ 500) like Django. */
async function sessionById(raw: unknown) {
  const id = pyUuid(raw);
  if (id === null) throw new Error(`“${pyStr(raw)}” is not a valid UUID.`);
  return db.selectFrom('chatbot_chatsession').selectAll().where('id', '=', id).executeTakeFirst();
}

async function getOrCreateSession(req: ApiRequest, sessionId: unknown) {
  const user = req.user;
  if (sessionId !== null) {
    const s = await sessionById(sessionId);
    if (s) {
      if (user && !s.user_id) {
        return db.updateTable('chatbot_chatsession').set({ user_id: user.id }).where('id', '=', s.id).returningAll().executeTakeFirstOrThrow();
      }
      return s;
    }
  }
  const now = nowPg();
  return db.insertInto('chatbot_chatsession').values({
    id: randomUUID(), user_id: user ? user.id : null, session_key: randomUUID(), handed_off: false, handoff_ticket_id: null, created_at: now, updated_at: now,
  }).returningAll().executeTakeFirstOrThrow();
}

const r = djangoRouter('api/chatbot/');

r.path('chat/', apiView({
  permissions: [AllowAny],
  throttles: [anonRateThrottle('chatbot')],
  async POST(req, res) {
    const { data } = await parseRequest(req, res);
    const message = pyStrip(pyStr(dget(data, 'message', '')));
    if (!message) return res.status(400).json({ error: 'message is required.' });
    if (pyLen(message) > 2000) return res.status(400).json({ error: 'message too long (max 2000 chars).' });
    const rawSid = dget(data, 'session_id');
    const session = await getOrCreateSession(req, pyTruthy(rawSid) ? rawSid : null);
    if (session.handed_off) {
      return {
        task_id: null, session_id: session.id, status: 'HANDED_OFF',
        reply: 'You are already connected with a support agent. Please continue the conversation in your Messages or Tickets.',
        needs_agent: false,
      };
    }
    const taskId = randomUUID();
    await delay('chatbot.tasks.get_chatbot_reply_task', [session.id, message], { jobId: taskId }); // apply_async(task_id=...)
    return { task_id: taskId, session_id: session.id };
  },
}));

r.path('status/<str:task_id>/', apiView({
  permissions: [AllowAny],
  async GET(req) {
    const job = await Job.fromId(queue('ai_scoring'), String(req.params.task_id));
    const state = job ? await job.getState() : 'unknown';
    if (state === 'completed') {
      const rv = job!.returnvalue;
      const d = (rv && typeof rv === 'object' && !Array.isArray(rv) ? rv : {}) as Record<string, unknown>;
      if (Array.isArray(rv) && rv.length) throw new TypeError("'list' object has no attribute 'get'");
      return { status: 'SUCCESS', reply: 'reply' in d ? d.reply : FALLBACK_REPLY, needs_agent: 'needs_agent' in d ? d.needs_agent : false };
    }
    if (state === 'failed') return { status: 'SUCCESS', reply: FALLBACK_REPLY, needs_agent: true };
    return { status: 'PENDING', reply: null, needs_agent: null };
  },
}));

r.path('handoff/', apiView({
  permissions: [AllowAny],
  async POST(req, res) {
    const { data } = await parseRequest(req, res);
    const sessionId = pyStrip(pyStr(dget(data, 'session_id', '')));
    if (!sessionId) return res.status(400).json({ error: 'session_id is required.' });
    const session = await sessionById(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    if (session.handed_off && session.handoff_ticket_id) {
      const t = await db.selectFrom('support_supportticket').selectAll().where('id', '=', session.handoff_ticket_id).executeTakeFirstOrThrow();
      return { ticket_number: t.ticket_number, ticket_id: t.id, conversation_id: t.conversation_id };
    }
    const messages = await db.selectFrom('chatbot_chatmessage').selectAll().where('session_id', '=', session.id).orderBy('created_at').execute();
    const transcript = messages.map((m) => `[${m.role === 'user' ? 'User' : 'Bot'}]: ${m.content}`).join('\n') || '(no messages)';
    const summary = pyStrip(pyStr(dget(data, 'summary', '')));
    const description = (summary ? `${summary}\n\n` : '') + `--- Chat transcript ---\n${transcript}`;
    const firstUser = messages.find((m) => m.role === 'user');
    const subject = (firstUser ? pySlice(firstUser.content, 100) : 'Chatbot handoff') || 'Chatbot handoff';

    const user = req.user;
    const guestName = pySlice(pyStrip(pyStr(dget(data, 'name', ''))), 100) || 'Guest';
    const guestEmail = pySlice(pyStrip(pyStr(dget(data, 'email', ''))), 254);

    let ticket = await createTicketWithSla({
      user_id: user ? user.id : null, guest_name: user ? '' : guestName, guest_email: user ? '' : guestEmail,
      category: 'other', subject, description, priority: 'medium',
    });
    await createTicketMessage({
      ticket_id: ticket.id, sender_id: user ? user.id : null, sender_name: user ? (fullName(user) || user.username) : guestName,
      is_staff_reply: false, content: description,
    });
    let conversationId: number | null = null;
    if (user) {
      const conv = await createSupportConversation(user, subject, description);
      if (conv) {
        ticket = await db.updateTable('support_supportticket').set({ conversation_id: conv }).where('id', '=', ticket.id).returningAll().executeTakeFirstOrThrow();
        conversationId = conv;
      }
    }
    await db.updateTable('chatbot_chatsession').set({ handed_off: true, handoff_ticket_id: ticket.id, updated_at: nowPg() })
      .where('id', '=', session.id).execute();
    return res.status(201).json({ ticket_number: ticket.ticket_number, ticket_id: ticket.id, conversation_id: conversationId });
  },
}));
