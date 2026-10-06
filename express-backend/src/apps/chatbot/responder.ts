// chatbot/responder.py — prompt construction + response parsing around the local LLM.
//
// Reuses the same single model loaded by aiscoring.model_service.get_model()
// (one node-llama-cpp instance per ai_scoring worker process, shared with the
// scoring tasks — see apps/aiscoring/llama_backend.ts).

import { pyJsonLoads, pyRepr, pyStr } from '../../domain/notifications.js';
import { logger } from '../../lib/logger.js';
import { getModel, ModelUnavailable } from '../aiscoring/model_service.js';
import { pyStrip, pyTruthy } from '../messaging/pyutil.js';

export { getModel, ModelUnavailable };

const log = logger.child({ logger: 'chatbot.responder' });

const HISTORY_TOKEN_BUDGET = 500;
const CHARS_PER_TOKEN = 3.5;

const SYSTEM_PROMPT = (knowledge: string) => `You are a helpful customer support chatbot for HomeKonet, a real-estate booking
platform in Liberia. Use ONLY the knowledge provided below to answer the user's
question. Do not make up information that is not in the knowledge base.

If the user asks about something you cannot answer from the provided knowledge,
or if they explicitly ask to speak to a human agent, set "needs_agent" to true.

Always reply with ONLY a JSON object in this exact format:
{"reply": "<your answer>", "needs_agent": false}

Keep replies concise and friendly. Do not include any text outside the JSON.

--- KNOWLEDGE BASE ---
${knowledge}
--- END KNOWLEDGE BASE ---
`;

export interface Turn { role: string; content: string }

export function trimHistory(history: Turn[]): Turn[] {
  const budget = Math.trunc(HISTORY_TOKEN_BUDGET * CHARS_PER_TOKEN);
  const selected: Turn[] = [];
  let used = 0;
  for (const turn of [...history].reverse()) {
    const cost = [...turn.content].length + 10;
    if (used + cost > budget) break;
    selected.push(turn);
    used += cost;
  }
  return selected.reverse();
}

export function buildMessages(knowledge: string, history: Turn[], userMessage: string) {
  const messages = [{ role: 'system', content: SYSTEM_PROMPT(knowledge) }];
  for (const t of trimHistory(history)) messages.push({ role: t.role === 'user' ? 'user' : 'assistant', content: t.content });
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

export function parseResponse(raw: string): { reply: string; needs_agent: boolean } {
  let data: unknown;
  try {
    data = pyJsonLoads(raw);
  } catch {
    const m = /\{[\s\S]*\}/.exec(raw || '');
    if (!m) return { reply: pyStrip(raw) || 'Sorry, I could not process that.', needs_agent: false };
    try { data = pyJsonLoads(m[0]); } catch { return { reply: pyStrip(raw), needs_agent: false }; }
  }
  const d = data as Record<string, unknown>;
  const reply = pyStrip(pyStr('reply' in d ? d.reply : '')) || 'Sorry, I could not process that.';
  return { reply, needs_agent: pyTruthy('needs_agent' in d ? d.needs_agent : false) };
}

/** get_chatbot_reply(knowledge, history, user_message) — raises ModelUnavailable without a model. */
export async function getChatbotReply(knowledge: string, history: Turn[], userMessage: string) {
  const model = await getModel();
  const completion = await model.createChatCompletion({
    messages: buildMessages(knowledge, history, userMessage), response_format: { type: 'json_object' }, temperature: 0.3, max_tokens: 512,
  });
  const raw = completion.choices[0]!.message.content;
  log.info(`Chatbot raw model output: ${pyRepr(raw)}`);
  return parseResponse(raw);
}
