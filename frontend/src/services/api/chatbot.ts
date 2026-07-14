import { fetchPublicJson } from './shared/client';

export interface ChatEnqueued {
  task_id: string | null;
  session_id: string;
  // Present when AI is off (immediate inline reply) or session is handed off
  status?: string;
  reply?: string;
  needs_agent?: boolean;
}

export interface ChatStatusResult {
  status: 'PENDING' | 'SUCCESS' | 'FAILURE';
  reply: string | null;
  needs_agent: boolean | null;
}

export interface HandoffResult {
  ticket_number: string;
  ticket_id: number;
  conversation_id: number | null;
}

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40; // 40 × 1.5 s = 60 s max wait

export const chatbotAPI = {
  /** Enqueue a message. Returns immediately with task_id + session_id. */
  send: (message: string, sessionId: string | null): Promise<ChatEnqueued> =>
    fetchPublicJson<ChatEnqueued>('/api/chatbot/chat/', {
      method: 'POST',
      body: JSON.stringify({ message, session_id: sessionId }),
    }),

  /** Poll once for a task result. */
  pollOnce: (taskId: string): Promise<ChatStatusResult> =>
    fetchPublicJson<ChatStatusResult>(`/api/chatbot/status/${taskId}/`),

  /**
   * Send a message and poll until the reply is ready.
   * Calls onPending() each poll cycle so the caller can show a spinner.
   * Resolves with { reply, needs_agent, session_id }.
   */
  async chat(
    message: string,
    sessionId: string | null,
    onPending?: () => void,
  ): Promise<{ reply: string; needs_agent: boolean; session_id: string }> {
    const enqueued = await this.send(message, sessionId);

    // Immediate reply (AI off, or session already handed off)
    if (!enqueued.task_id || enqueued.status === 'SUCCESS' || enqueued.status === 'HANDED_OFF') {
      return {
        reply: enqueued.reply ?? "I'm not able to answer that right now.",
        needs_agent: enqueued.needs_agent ?? false,
        session_id: enqueued.session_id,
      };
    }

    // Poll for result
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      onPending?.();
      const result = await this.pollOnce(enqueued.task_id);
      if (result.status === 'SUCCESS') {
        return {
          reply: result.reply ?? "I'm not able to answer that right now.",
          needs_agent: result.needs_agent ?? false,
          session_id: enqueued.session_id,
        };
      }
    }

    // Timed out
    return {
      reply: "Sorry, the response took too long. Would you like to connect with a support agent?",
      needs_agent: true,
      session_id: enqueued.session_id,
    };
  },

  handoff: (
    sessionId: string,
    opts?: { summary?: string; name?: string; email?: string },
  ): Promise<HandoffResult> =>
    fetchPublicJson<HandoffResult>('/api/chatbot/handoff/', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, ...opts }),
    }),
};
