import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Send, ArrowLeft, Search, X, MessageSquare,
  Check, CheckCheck, MoreVertical, Home,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn, formatDate, getInitials } from '../../core/utils';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';
import { messagesAPI } from '../../services/api.service';
import type { Conversation, Message } from '../../core/types';
import { useChatSocket } from '../../hooks/useChatSocket';
import type { ChatMessage } from '../../hooks/useChatSocket';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../hooks/queries/keys';
import { isToday, isYesterday, parseISO, format } from 'date-fns';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOtherParticipant(conv: Conversation, myId?: string) {
  return conv.participants.find(p => p.id !== myId) ?? conv.participants[0];
}

function dateLabel(iso: string) {
  try {
    const d = parseISO(iso);
    if (isToday(d)) return 'Today';
    if (isYesterday(d)) return 'Yesterday';
    return format(d, 'MMMM d, yyyy');
  } catch { return ''; }
}

function msgTime(iso: string) {
  try { return format(parseISO(iso), 'h:mm a'); }
  catch { return ''; }
}

function groupByDate(messages: Message[]) {
  const map = new Map<string, Message[]>();
  for (const m of messages) {
    try {
      const key = format(parseISO(m.createdAt), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    } catch { /* skip */ }
  }
  return Array.from(map.entries());
}

// ── Conversation list item ────────────────────────────────────────────────────

function ConvItem({
  conv, active, myId, onClick,
}: { conv: Conversation; active: boolean; myId?: string; onClick: () => void }) {
  const other = getOtherParticipant(conv, myId);
  const name = [other?.firstName, other?.lastName].filter(Boolean).join(' ') || other?.email || 'Conversation';
  const preview = conv.lastMessage?.content || 'No messages yet';
  const ts = conv.lastMessage?.createdAt ?? conv.updatedAt;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-colors',
        active ? 'bg-primary/10' : 'hover:bg-muted/60',
      )}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        {other?.avatar
          ? <img src={other.avatar} alt={name} className="w-12 h-12 rounded-full object-cover" />
          : <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm select-none">
              {getInitials(other?.firstName ?? 'C', other?.lastName ?? 'U')}
            </div>
        }
        {conv.unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
            {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
          </span>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline gap-1">
          <p className={cn('font-semibold text-sm truncate', conv.unreadCount > 0 && 'text-foreground')}>{name}</p>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{msgTime(ts)}</span>
        </div>
        <p className={cn('text-xs truncate mt-0.5', conv.unreadCount > 0 ? 'text-foreground font-medium' : 'text-muted-foreground')}>
          {preview}
        </p>
        {conv.propertyId && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground mt-0.5">
            <Home className="w-2.5 h-2.5" /> Property listing
          </span>
        )}
      </div>
    </button>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function Bubble({ msg, isMine, isLast }: { msg: Message; isMine: boolean; isLast: boolean }) {
  return (
    <div className={cn('flex items-end gap-2', isMine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[72%] sm:max-w-[60%] space-y-0.5', isMine && 'items-end flex flex-col')}>
        <div className={cn(
          'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
          isMine
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm',
        )}>
          {msg.content}
        </div>
        {isLast && (
          <div className={cn('flex items-center gap-1 text-[10px]', isMine ? 'justify-end text-muted-foreground' : 'text-muted-foreground')}>
            <span>{msgTime(msg.createdAt)}</span>
            {isMine && (
              msg.read
                ? <CheckCheck className="w-3 h-3 text-primary" />
                : <Check className="w-3 h-3" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat pane ─────────────────────────────────────────────────────────────────

function ChatPane({
  conversation,
  myId,
  onBack,
}: { conversation: Conversation; myId?: string; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const other = getOtherParticipant(conversation, myId);
  const otherName = [other?.firstName, other?.lastName].filter(Boolean).join(' ') || other?.email || 'User';

  // Load message history
  useEffect(() => {
    setLoading(true);
    messagesAPI.getMessages(conversation.id)
      .then(setMessages)
      .catch(() => toast.error('Failed to load messages'))
      .finally(() => setLoading(false));
  }, [conversation.id]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Real-time WebSocket
  const handleWsMessage = useCallback((wsMsg: ChatMessage) => {
    const newMsg: Message = {
      id: String(wsMsg.message_id),
      conversationId: String(wsMsg.conversation_id),
      senderId: String(wsMsg.sender_id),
      sender: { id: String(wsMsg.sender_id), email: wsMsg.sender_email, firstName: wsMsg.sender_email.split('@')[0], lastName: '', isHost: false, verified: true, createdAt: wsMsg.created_at },
      receiverId: '',
      receiver: { id: '', email: '', firstName: '', lastName: '', isHost: false, verified: true, createdAt: wsMsg.created_at },
      content: wsMsg.content,
      read: false,
      createdAt: wsMsg.created_at,
    };
    setMessages(prev => {
      // deduplicate by id
      if (prev.some(m => m.id === newMsg.id)) return prev;
      return [...prev, newMsg];
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations });
  }, [queryClient]);

  const { sendMessage: wsSend, markRead } = useChatSocket({
    conversationId: Number(conversation.id),
    onMessage: handleWsMessage,
    onConnected: () => markRead(),
  });

  const doSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    // Optimistic bubble
    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      conversationId: conversation.id,
      senderId: myId ?? '',
      sender: { id: myId ?? '', email: '', firstName: 'Me', lastName: '', isHost: false, verified: true, createdAt: new Date().toISOString() },
      receiverId: '', receiver: { id: '', email: '', firstName: '', lastName: '', isHost: false, verified: true, createdAt: new Date().toISOString() },
      content: text,
      read: false,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      // Prefer WS if connected, fall back to HTTP
      wsSend(text);
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations });
    } catch {
      // WS not ready — use HTTP
      try {
        const sent = await messagesAPI.sendMessage(conversation.id, text);
        setMessages(prev => prev.map(m => m.id === optimistic.id ? sent : m));
        queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations });
      } catch {
        setMessages(prev => prev.filter(m => m.id !== optimistic.id));
        setInput(text);
        toast.error('Failed to send message');
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const groups = groupByDate(messages);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
        <button type="button" onClick={onBack} className="lg:hidden p-1.5 rounded-full hover:bg-muted mr-1" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        {other?.avatar
          ? <img src={other.avatar} alt={otherName} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          : <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm flex-shrink-0 select-none">
              {getInitials(other?.firstName ?? 'C', other?.lastName ?? 'U')}
            </div>
        }
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{otherName}</p>
          {conversation.propertyId && (
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Home className="w-3 h-3 flex-shrink-0" /> Property inquiry
            </p>
          )}
        </div>
        <Button type="button" variant="ghost" size="icon" className="flex-shrink-0">
          <MoreVertical className="w-4 h-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No messages yet. Say hello!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map(([dateKey, msgs]) => (
              <div key={dateKey} className="space-y-2">
                {/* Date separator */}
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground px-2 font-medium">
                    {dateLabel(msgs[0].createdAt)}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {msgs.map((msg, i) => {
                  const isMine = msg.senderId === myId;
                  const isLast = i === msgs.length - 1;
                  const showAvatar = !isMine && (i === 0 || msgs[i - 1].senderId !== msg.senderId);

                  return (
                    <div key={msg.id} className={cn('flex items-end gap-2', isMine ? 'justify-end' : 'justify-start')}>
                      {/* Other user avatar for first in run */}
                      {!isMine && (
                        <div className="w-7 flex-shrink-0">
                          {showAvatar && (
                            other?.avatar
                              ? <img src={other.avatar} alt="" className="w-7 h-7 rounded-full object-cover" />
                              : <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">
                                  {getInitials(other?.firstName ?? 'C', other?.lastName ?? 'U')}
                                </div>
                          )}
                        </div>
                      )}
                      <Bubble msg={msg} isMine={isMine} isLast={isLast} />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border bg-card/50 p-3 flex-shrink-0">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/50 focus-within:border-ring transition-[box-shadow]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
            rows={1}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none leading-relaxed overflow-auto resize-none min-h-6 max-h-28"
            onInput={e => {
              const el = e.currentTarget;
              el.style.blockSize = 'auto';
              el.style.blockSize = `${Math.min(el.scrollHeight, 112)}px`;
            }}
          />
          <button
            type="button"
            onClick={doSend}
            disabled={!input.trim() || sending}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors"
            aria-label="Send message"
          >
            {sending
              ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              : <Send className="w-3.5 h-3.5" />
            }
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}

// ── Main Messages page ────────────────────────────────────────────────────────

export function Messages() {
  const { isAuthenticated, user } = useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Load conversations
  useEffect(() => {
    if (!isAuthenticated) return;
    messagesAPI.getConversations()
      .then(setConversations)
      .catch(() => toast.error('Failed to load conversations'))
      .finally(() => setLoadingConvs(false));
  }, [isAuthenticated]);

  // Auto-select from URL param ?conversation=<id>
  useEffect(() => {
    const paramId = searchParams.get('conversation');
    if (paramId) {
      setSelectedId(paramId);
    } else if (!selectedId && conversations.length > 0) {
      setSelectedId(conversations[0].id);
    }
  }, [conversations, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter(c => {
      const other = getOtherParticipant(c, user?.id);
      const name = [other?.firstName, other?.lastName].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || (other?.email ?? '').toLowerCase().includes(q);
    });
  }, [conversations, search, user?.id]);

  const selectedConversation = useMemo(
    () => conversations.find(c => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const handleSelectConversation = (id: string) => {
    setSelectedId(id);
    navigate(`/messages?conversation=${id}`, { replace: true });
  };

  if (!isAuthenticated) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground" />
          <p className="text-muted-foreground">Sign in to view your messages</p>
        </div>
      </div>
    );
  }

  const showList = !selectedId;

  return (
    <div className="h-[calc(100vh-4rem)] flex bg-background overflow-hidden">
      {/* Sidebar */}
      <div className={cn(
        'w-full lg:w-80 xl:w-96 flex-shrink-0 flex flex-col border-r border-border bg-card/30',
        selectedId ? 'hidden lg:flex' : 'flex',
      )}>
        {/* Sidebar header */}
        <div className="px-4 pt-5 pb-3 border-b border-border flex-shrink-0 space-y-3">
          <h1 className="text-xl font-semibold">Messages</h1>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search conversations…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-background border-border"
            />
            {search && (
              <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {loadingConvs ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl animate-pulse">
                  <div className="w-12 h-12 rounded-full bg-muted flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded w-2/3" />
                    <div className="h-2 bg-muted rounded w-4/5" />
                  </div>
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="text-center py-16">
                <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  {search ? 'No conversations match' : 'No conversations yet'}
                </p>
              </div>
            ) : (
              filtered.map(conv => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === selectedId}
                  myId={user?.id}
                  onClick={() => handleSelectConversation(conv.id)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Chat pane */}
      {selectedConversation ? (
        <ChatPane
          key={selectedConversation.id}
          conversation={selectedConversation}
          myId={user?.id}
          onBack={() => { setSelectedId(null); navigate('/messages', { replace: true }); }}
        />
      ) : (
        <div className={cn('flex-1 items-center justify-center text-muted-foreground', showList ? 'hidden lg:flex' : 'flex')}>
          <div className="text-center space-y-3">
            <MessageSquare className="w-12 h-12 mx-auto opacity-30" />
            <p className="text-sm">Select a conversation to start messaging</p>
          </div>
        </div>
      )}
    </div>
  );
}
