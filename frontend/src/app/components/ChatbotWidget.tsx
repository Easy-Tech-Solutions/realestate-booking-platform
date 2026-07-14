import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, UserCheck, ChevronDown, RotateCcw } from 'lucide-react';
import { chatbotAPI } from '../../services/api/chatbot';
import { useApp } from '../../hooks/useApp';

interface Message {
  id: string;
  role: 'user' | 'bot';
  content: string;
  suggestHandoff?: boolean;
}

// Persist session across page navigations AND browser restarts
const LS_SESSION_KEY = 'hk_chatbot_session';
const LS_MESSAGES_KEY = 'hk_chatbot_messages';
const LS_HANDEDOFF_KEY = 'hk_chatbot_handedoff';
const LS_TICKET_KEY = 'hk_chatbot_ticket';

const WELCOME: Message = {
  id: 'welcome',
  role: 'bot',
  content: "Hi! I'm HomeKonet's virtual assistant. Ask me anything about listings, bookings, payments, or how the platform works.",
};

function genId() {
  return Math.random().toString(36).slice(2);
}

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(LS_MESSAGES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [WELCOME];
}

function saveMessages(msgs: Message[]) {
  try {
    // Keep last 40 messages to avoid unbounded localStorage growth
    localStorage.setItem(LS_MESSAGES_KEY, JSON.stringify(msgs.slice(-40)));
  } catch {}
}

export function ChatbotWidget() {
  const { user } = useApp();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => loadMessages());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(
    () => localStorage.getItem(LS_SESSION_KEY),
  );
  const [handedOff, setHandedOff] = useState(
    () => localStorage.getItem(LS_HANDEDOFF_KEY) === '1',
  );
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [ticketNumber, setTicketNumber] = useState<string | null>(
    () => localStorage.getItem(LS_TICKET_KEY),
  );
  // Guest handoff: name/email are optional — pre-fill from user if logged in
  const [showGuestForm, setShowGuestForm] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Pre-fill guest fields from logged-in user
  useEffect(() => {
    if (user) {
      setGuestName(`${user.firstName} ${user.lastName}`.trim() || user.email);
      setGuestEmail(user.email);
    }
  }, [user]);

  // Scroll to bottom whenever messages change or panel opens
  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      inputRef.current?.focus();
    }
  }, [open, messages]);

  // Persist messages to localStorage whenever they change
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const persistSession = useCallback((id: string) => {
    setSessionId(id);
    localStorage.setItem(LS_SESSION_KEY, id);
  }, []);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || handedOff) return;

    const userMsg: Message = { id: genId(), role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setWaitSeconds(0);

    try {
      const res = await chatbotAPI.chat(trimmed, sessionId, () => {
        setWaitSeconds((s) => s + 3);
      });
      if (res.session_id) persistSession(res.session_id);

      setMessages((prev) => [
        ...prev,
        { id: genId(), role: 'bot', content: res.reply, suggestHandoff: res.needs_agent },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'bot',
          content: "Sorry, I couldn't process that. Please try again or connect with a support agent.",
          suggestHandoff: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleHandoff = async (opts?: { name?: string; email?: string }) => {
    if (handedOff) return;

    // If no session yet, create one first by sending a silent ping
    let sid = sessionId;
    if (!sid) {
      try {
        const enqueued = await chatbotAPI.send('(handoff requested)', null);
        sid = enqueued.session_id;
        persistSession(sid);
      } catch {
        setMessages((prev) => [
          ...prev,
          { id: genId(), role: 'bot', content: 'Failed to connect. Please visit the Support page.' },
        ]);
        return;
      }
    }

    setHandoffLoading(true);
    try {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      const res = await chatbotAPI.handoff(sid, {
        summary: lastUserMsg?.content,
        ...opts,
      });
      setHandedOff(true);
      setTicketNumber(res.ticket_number);
      localStorage.setItem(LS_HANDEDOFF_KEY, '1');
      localStorage.setItem(LS_TICKET_KEY, res.ticket_number);
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'bot',
          content: `You've been connected to a support agent. Your ticket number is **${res.ticket_number}**. We'll get back to you as soon as possible.`,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: 'bot',
          content: 'Failed to connect you with an agent. Please visit the Support page to submit a ticket.',
        },
      ]);
    } finally {
      setHandoffLoading(false);
      setShowGuestForm(false);
    }
  };

  const onHandoffClick = () => {
    if (handedOff) return;
    // If not logged in and no name/email yet, show the optional form
    if (!user && (!guestName || !guestEmail)) {
      setShowGuestForm(true);
      return;
    }
    handleHandoff(user ? undefined : { name: guestName, email: guestEmail });
  };

  const onGuestHandoffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Name/email are optional — proceed even if blank
    handleHandoff({ name: guestName.trim() || undefined, email: guestEmail.trim() || undefined });
  };

  /** Start a completely fresh conversation */
  const resetChat = () => {
    setMessages([WELCOME]);
    setSessionId(null);
    setHandedOff(false);
    setTicketNumber(null);
    setShowGuestForm(false);
    setInput('');
    localStorage.removeItem(LS_SESSION_KEY);
    localStorage.removeItem(LS_MESSAGES_KEY);
    localStorage.removeItem(LS_HANDEDOFF_KEY);
    localStorage.removeItem(LS_TICKET_KEY);
  };

  const hasSuggestedHandoff = messages.some((m) => m.suggestHandoff);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-[60] w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
      >
        {open ? <ChevronDown className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-36 right-4 md:bottom-24 md:right-6 z-[60] w-[calc(100vw-2rem)] max-w-sm bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ height: '480px' }}
        >
          {/* Header */}
          <div className="bg-primary px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-primary-foreground" />
              <span className="text-primary-foreground font-semibold text-sm">HomeKonet Assistant</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={resetChat}
                title="Start new conversation"
                className="text-primary-foreground/70 hover:text-primary-foreground transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-primary-foreground/70 hover:text-primary-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  }`}
                >
                  {msg.content.split('**').map((part, i) =>
                    i % 2 === 1 ? <strong key={i}>{part}</strong> : part,
                  )}
                  {msg.suggestHandoff && !handedOff && (
                    <button
                      onClick={onHandoffClick}
                      disabled={handoffLoading}
                      className="mt-2 flex items-center gap-1.5 text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                    >
                      <UserCheck className="w-3.5 h-3.5" />
                      Connect me with an agent
                    </button>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {waitSeconds < 15
                      ? 'Thinking…'
                      : waitSeconds < 60
                      ? `Still thinking… (${waitSeconds}s)`
                      : `Loading AI model… (${Math.floor(waitSeconds / 60)}m ${waitSeconds % 60}s) — first message takes a few minutes`}
                  </span>
                </div>
              </div>
            )}

            {/* Optional guest contact form — shown before handoff */}
            {showGuestForm && !handedOff && (
              <form onSubmit={onGuestHandoffSubmit} className="bg-muted rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Your contact details{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </p>
                <input
                  className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Full name (optional)"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                />
                <input
                  type="email"
                  className="w-full text-sm border border-border rounded-lg px-3 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Email address (optional)"
                  value={guestEmail}
                  onChange={(e) => setGuestEmail(e.target.value)}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={handoffLoading}
                    className="flex-1 text-xs bg-primary text-primary-foreground rounded-lg py-1.5 font-medium hover:opacity-90 disabled:opacity-60"
                  >
                    {handoffLoading ? 'Connecting…' : 'Connect to agent'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowGuestForm(false)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Persistent handoff bar */}
          {hasSuggestedHandoff && !handedOff && !showGuestForm && (
            <div className="px-4 pb-2 shrink-0">
              <button
                onClick={onHandoffClick}
                disabled={handoffLoading}
                className="w-full flex items-center justify-center gap-2 text-xs font-medium border border-primary text-primary rounded-lg py-2 hover:bg-primary/5 transition-colors disabled:opacity-60"
              >
                <UserCheck className="w-3.5 h-3.5" />
                {handoffLoading ? 'Connecting…' : 'Connect me with a support agent'}
              </button>
            </div>
          )}

          {/* Input */}
          {!handedOff && (
            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
              className="px-3 pb-3 pt-1 flex gap-2 shrink-0 border-t border-border"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                disabled={loading}
                maxLength={2000}
                className="flex-1 text-sm border border-border rounded-xl px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!input.trim() || loading}
                className="w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 disabled:opacity-40 shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}

          {/* Post-handoff footer */}
          {handedOff && (
            <div className="px-4 pb-3 pt-2 shrink-0 border-t border-border space-y-2">
              <p className="text-center text-xs text-muted-foreground">
                Ticket{' '}
                <span className="font-mono font-semibold text-primary">{ticketNumber}</span>
                {' '}— check your tickets for updates.
              </p>
              <button
                onClick={resetChat}
                className="w-full text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg py-1.5 transition-colors"
              >
                Start a new conversation
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
