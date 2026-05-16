import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Send, ArrowLeft, Search, X, MessageSquare,
  Check, CheckCheck, MoreVertical, Home, Paperclip,
  FileText, ImageIcon, Download, Pencil, Trash2, AlertTriangle,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { ScrollArea } from '../components/ui/scroll-area';
import { cn, formatDate, getInitials } from '../../core/utils';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';
import { messagesAPI } from '../../services/api.service';
import type { Conversation, Message, MessageAttachment } from '../../core/types';
import { useChatSocket } from '../../hooks/useChatSocket';
import type { ChatMessage, EditedMessage, ReadReceipt } from '../../hooks/useChatSocket';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../hooks/queries/keys';
import { isToday, isYesterday, parseISO, format, differenceInMinutes } from 'date-fns';

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

function canEdit(msg: Message, myId?: string) {
  if (msg.senderId !== myId) return false;
  try { return differenceInMinutes(new Date(), parseISO(msg.createdAt)) < 3; }
  catch { return false; }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isOnline(lastSeen?: string) {
  if (!lastSeen) return false;
  try { return differenceInMinutes(new Date(), parseISO(lastSeen)) < 2; }
  catch { return false; }
}

// ── Online dot ────────────────────────────────────────────────────────────────

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span className={cn(
      'absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background',
      online ? 'bg-green-500' : 'bg-muted-foreground/40',
    )} />
  );
}

// ── Attachment renderer ───────────────────────────────────────────────────────

function AttachmentView({ att }: { att: MessageAttachment }) {
  if (att.fileType === 'image') {
    return (
      <a href={att.fileUrl} target="_blank" rel="noreferrer" className="block">
        <img
          src={att.fileUrl}
          alt={att.fileName}
          className="max-w-[220px] rounded-xl mt-1 cursor-pointer hover:opacity-90 transition-opacity"
        />
      </a>
    );
  }
  return (
    <a
      href={att.fileUrl}
      target="_blank"
      rel="noreferrer"
      download={att.fileName}
      className="flex items-center gap-2 mt-1.5 px-3 py-2 rounded-xl bg-black/10 hover:bg-black/20 transition-colors max-w-[240px]"
    >
      <FileText className="w-4 h-4 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{att.fileName}</p>
        <p className="text-[10px] opacity-70">{formatBytes(att.fileSize)}</p>
      </div>
      <Download className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
    </a>
  );
}

// ── Conversation list item ────────────────────────────────────────────────────

function ConvItem({
  conv, active, myId, onClick,
}: { conv: Conversation; active: boolean; myId?: string; onClick: () => void }) {
  const other = getOtherParticipant(conv, myId);
  const name = [other?.firstName, other?.lastName].filter(Boolean).join(' ') || other?.email || 'Conversation';
  const preview = conv.lastMessage?.content
    ? (conv.lastMessage.content.length > 50 ? conv.lastMessage.content.slice(0, 50) + '…' : conv.lastMessage.content)
    : conv.lastMessage?.attachments?.length
      ? '📎 Attachment'
      : 'No messages yet';
  const ts = conv.lastMessage?.createdAt ?? conv.updatedAt;
  const online = isOnline(other?.lastSeen);

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
        <OnlineDot online={online} />
        {conv.unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
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

function Bubble({
  msg, isMine, isLastInThread, myId, onEdit,
}: {
  msg: Message; isMine: boolean; isLastInThread: boolean; myId?: string;
  onEdit: (msg: Message) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const editable = canEdit(msg, myId);

  return (
    <div
      className={cn('flex items-end gap-2', isMine ? 'justify-end' : 'justify-start')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={cn('max-w-[72%] sm:max-w-[60%] space-y-0.5 relative', isMine && 'items-end flex flex-col')}>
        {/* Edit pencil */}
        {isMine && editable && hovered && (
          <button
            type="button"
            aria-label="Edit message"
            onClick={() => onEdit(msg)}
            className={cn(
              'absolute -left-7 top-1 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors',
            )}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Bubble */}
        <div className={cn(
          'px-4 py-2.5 rounded-2xl text-sm leading-relaxed',
          isMine
            ? 'bg-primary text-primary-foreground rounded-br-sm'
            : 'bg-muted text-foreground rounded-bl-sm',
        )}>
          {msg.content}
          {msg.editedAt && (
            <span className="ml-1.5 text-[10px] opacity-60">(edited)</span>
          )}
        </div>

        {/* Attachments */}
        {msg.attachments?.map(att => (
          <AttachmentView key={att.id} att={att} />
        ))}

        {/* Timestamp + read receipt */}
        {isLastInThread && (
          <div className={cn('flex items-center gap-1 text-[10px]', isMine ? 'justify-end text-muted-foreground' : 'text-muted-foreground')}>
            <span>{msgTime(msg.createdAt)}</span>
            {isMine && (
              msg.read
                ? <CheckCheck className="w-3 h-3 text-primary" title="Seen" />
                : <Check className="w-3 h-3" title="Sent" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── File preview strip ────────────────────────────────────────────────────────

function FilePreview({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2 pb-1">
      {files.map((f, i) => {
        const isImg = f.type.startsWith('image/');
        return (
          <div key={i} className="relative group">
            {isImg ? (
              <img
                src={URL.createObjectURL(f)}
                alt={f.name}
                className="w-16 h-16 rounded-lg object-cover border border-border"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg border border-border bg-muted flex flex-col items-center justify-center gap-1 px-1">
                <FileText className="w-5 h-5 text-muted-foreground" />
                <p className="text-[8px] text-muted-foreground truncate w-full text-center px-1">{f.name.split('.').pop()?.toUpperCase()}</p>
              </div>
            )}
            <button
              type="button"
              aria-label="Remove file"
              onClick={() => onRemove(i)}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Delete confirmation ───────────────────────────────────────────────────────

function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full mx-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-destructive" />
          </div>
          <div>
            <p className="font-semibold">Delete conversation?</p>
            <p className="text-sm text-muted-foreground">This removes it from your inbox. The other person keeps their copy.</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="destructive" className="flex-1" onClick={onConfirm}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

// ── Chat pane ─────────────────────────────────────────────────────────────────

function ChatPane({
  conversation,
  myId,
  onBack,
  onDeleted,
}: {
  conversation: Conversation;
  myId?: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const other = getOtherParticipant(conversation, myId);
  const otherName = [other?.firstName, other?.lastName].filter(Boolean).join(' ') || other?.email || 'User';

  // Load messages
  useEffect(() => {
    setLoading(true);
    messagesAPI.getMessages(conversation.id)
      .then(setMessages)
      .catch(() => toast.error('Failed to load messages'))
      .finally(() => setLoading(false));
  }, [conversation.id]);

  // Poll presence every 30s
  useEffect(() => {
    if (!other?.id) return;
    const check = () => {
      messagesAPI.getPresence(other.id)
        .then(p => setOtherOnline(p.online))
        .catch(() => {});
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, [other?.id]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // WS callbacks
  const handleWsMessage = useCallback((wsMsg: ChatMessage) => {
    const newMsg: Message = {
      id: String(wsMsg.message_id),
      conversationId: String(wsMsg.conversation_id),
      senderId: String(wsMsg.sender_id),
      sender: {
        id: String(wsMsg.sender_id), email: wsMsg.sender_email,
        firstName: wsMsg.sender_email.split('@')[0], lastName: '',
        isHost: false, verified: true, createdAt: wsMsg.created_at,
      },
      receiverId: '',
      receiver: { id: '', email: '', firstName: '', lastName: '', isHost: false, verified: true, createdAt: wsMsg.created_at },
      content: wsMsg.content,
      messageType: (wsMsg.message_type as any) || 'text',
      read: false,
      attachments: [],
      createdAt: wsMsg.created_at,
    };
    setMessages(prev => {
      if (prev.some(m => m.id === newMsg.id)) return prev;
      return [...prev, newMsg];
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations });
    // Reload if has attachments so we get proper attachment URLs
    if (wsMsg.has_attachments) {
      messagesAPI.getMessages(conversation.id).then(setMessages).catch(() => {});
    }
  }, [queryClient, conversation.id]);

  const handleWsEdit = useCallback((edit: EditedMessage) => {
    setMessages(prev => prev.map(m =>
      m.id === String(edit.message_id)
        ? { ...m, content: edit.content, editedAt: edit.edited_at }
        : m
    ));
  }, []);

  const handleWsReadReceipt = useCallback((_receipt: ReadReceipt) => {
    // Mark all my sent messages as read
    setMessages(prev => prev.map(m =>
      m.senderId === myId ? { ...m, read: true } : m
    ));
  }, [myId]);

  const { markRead } = useChatSocket({
    conversationId: Number(conversation.id),
    onMessage: handleWsMessage,
    onMessageEdited: handleWsEdit,
    onReadReceipt: handleWsReadReceipt,
    onConnected: () => markRead(),
  });

  // Send
  const doSend = async () => {
    const text = input.trim();
    if ((!text && !files.length) || sending) return;
    setInput('');
    const sentFiles = [...files];
    setFiles([]);
    setSending(true);

    const optimistic: Message = {
      id: `opt-${Date.now()}`,
      conversationId: conversation.id,
      senderId: myId ?? '',
      sender: { id: myId ?? '', email: '', firstName: 'Me', lastName: '', isHost: false, verified: true, createdAt: new Date().toISOString() },
      receiverId: '', receiver: { id: '', email: '', firstName: '', lastName: '', isHost: false, verified: true, createdAt: new Date().toISOString() },
      content: text,
      messageType: sentFiles.length ? (text ? 'text_file' : 'file') : 'text',
      read: false,
      attachments: [],
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const sent = sentFiles.length
        ? await messagesAPI.sendMessageWithFiles(conversation.id, text, sentFiles)
        : await messagesAPI.sendMessage(conversation.id, text);
      setMessages(prev => prev.map(m => m.id === optimistic.id ? sent : m));
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations });
    } catch {
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setInput(text);
      setFiles(sentFiles);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Edit
  const startEdit = (msg: Message) => {
    setEditingMsg(msg);
    setEditContent(msg.content);
    setTimeout(() => editRef.current?.focus(), 50);
    setMenuOpen(false);
  };

  const saveEdit = async () => {
    if (!editingMsg || !editContent.trim() || editSaving) return;
    setEditSaving(true);
    try {
      const updated = await messagesAPI.editMessage(editingMsg.id, editContent.trim());
      setMessages(prev => prev.map(m => m.id === updated.id ? updated : m));
    } catch {
      toast.error('Failed to edit message');
    } finally {
      setEditSaving(false);
      setEditingMsg(null);
    }
  };

  // Delete conversation
  const doDelete = async () => {
    try {
      await messagesAPI.deleteConversation(conversation.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations });
      onDeleted();
    } catch {
      toast.error('Failed to delete conversation');
    }
    setConfirmDelete(false);
  };

  // File picker
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    setFiles(prev => [...prev, ...picked].slice(0, 5));
    e.target.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  };

  const groups = groupByDate(messages);
  // The last message sent by me (for accurate read receipt positioning)
  const lastMyMsgId = [...messages].reverse().find(m => m.senderId === myId)?.id;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background relative">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/50 backdrop-blur-sm flex-shrink-0">
        <button type="button" onClick={onBack} className="lg:hidden p-1.5 rounded-full hover:bg-muted mr-1" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Avatar with online dot */}
        <div className="relative flex-shrink-0">
          {other?.avatar
            ? <img src={other.avatar} alt={otherName} className="w-10 h-10 rounded-full object-cover" />
            : <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold text-sm select-none">
                {getInitials(other?.firstName ?? 'C', other?.lastName ?? 'U')}
              </div>
          }
          <OnlineDot online={otherOnline} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{otherName}</p>
          <p className="text-xs text-muted-foreground">
            {otherOnline ? (
              <span className="text-green-600 font-medium">Active now</span>
            ) : other?.lastSeen ? (
              `Last seen ${msgTime(other.lastSeen)}`
            ) : (
              conversation.propertyId
                ? <span className="flex items-center gap-1"><Home className="w-3 h-3 flex-shrink-0" /> Property inquiry</span>
                : 'Offline'
            )}
          </p>
        </div>

        {/* Three-dot menu */}
        <div className="relative" ref={menuRef}>
          <Button type="button" variant="ghost" size="icon" className="flex-shrink-0" onClick={() => setMenuOpen(v => !v)} aria-label="More options">
            <MoreVertical className="w-4 h-4" />
          </Button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-10">
              <button
                type="button"
                onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete conversation
              </button>
            </div>
          )}
        </div>
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
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground px-2 font-medium">
                    {dateLabel(msgs[0].createdAt)}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {msgs.map((msg, i) => {
                  const isMine = msg.senderId === myId;
                  const isLastInThread = i === msgs.length - 1 || msgs[i + 1].senderId !== msg.senderId;
                  const showAvatar = !isMine && (i === 0 || msgs[i - 1].senderId !== msg.senderId);

                  return (
                    <div key={msg.id} className={cn('flex items-end gap-2', isMine ? 'justify-end' : 'justify-start')}>
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
                      <Bubble
                        msg={msg}
                        isMine={isMine}
                        isLastInThread={isLastInThread && msg.id === lastMyMsgId ? true : isLastInThread && !isMine ? true : msg.id === lastMyMsgId}
                        myId={myId}
                        onEdit={startEdit}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </ScrollArea>

      {/* Edit bar */}
      {editingMsg && (
        <div className="border-t border-border bg-yellow-50 dark:bg-yellow-950/20 px-4 py-2 flex items-center gap-3 flex-shrink-0">
          <Pencil className="w-4 h-4 text-yellow-600 flex-shrink-0" />
          <input
            ref={editRef}
            type="text"
            aria-label="Edit message"
            title="Edit message"
            placeholder="Edit your message…"
            value={editContent}
            onChange={e => setEditContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingMsg(null); }}
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
          <button type="button" onClick={saveEdit} disabled={editSaving || !editContent.trim()} className="text-xs font-semibold text-primary hover:text-primary/80 disabled:opacity-40">
            {editSaving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditingMsg(null)} className="text-xs text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      )}

      {/* File preview */}
      {files.length > 0 && <FilePreview files={files} onRemove={i => setFiles(prev => prev.filter((_, j) => j !== i))} />}

      {/* Input */}
      <div className="border-t border-border bg-card/50 p-3 flex-shrink-0">
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring/50 focus-within:border-ring transition-[box-shadow]">
          {/* Paperclip */}
          <button
            type="button"
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="flex-shrink-0 p-1 text-muted-foreground hover:text-primary transition-colors self-end mb-0.5"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx"
            className="hidden"
            onChange={onFileChange}
          />

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
            disabled={(!input.trim() && !files.length) || sending}
            className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-colors self-end"
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

      {/* Delete confirmation overlay */}
      {confirmDelete && (
        <DeleteConfirm
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
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

  const reload = useCallback(() => {
    messagesAPI.getConversations()
      .then(setConversations)
      .catch(() => toast.error('Failed to load conversations'))
      .finally(() => setLoadingConvs(false));
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    reload();
  }, [isAuthenticated, reload]);

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

  const handleDeleted = () => {
    setSelectedId(null);
    navigate('/messages', { replace: true });
    reload();
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
          onDeleted={handleDeleted}
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
