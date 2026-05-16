import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Send,
  Paperclip,
  Loader2,
  TicketIcon,
  Clock,
  User,
  ExternalLink,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Textarea } from '../components/ui/textarea';
import { useApp } from '../../hooks/useApp';
import { supportAPI, type SupportTicket, type TicketMessage } from '../../services/api/support';

// ── Status helpers ─────────────────────────────────────────────────────────────

type Status = SupportTicket['status'];
type Priority = SupportTicket['priority'];

const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  pending_user: 'Awaiting You',
  resolved: 'Resolved',
  closed: 'Closed',
};

const STATUS_CLASSES: Record<Status, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  pending_user: 'bg-orange-100 text-orange-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};

const PRIORITY_CLASSES: Record<Priority, string> = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-50 text-blue-600',
  high: 'bg-orange-50 text-orange-600',
  urgent: 'bg-red-100 text-red-600',
};

function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${PRIORITY_CLASSES[priority]}`}
    >
      {priority}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: TicketMessage }) {
  return (
    <div className={`flex gap-3 ${msg.isStaffReply ? '' : 'flex-row-reverse'}`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold ${
          msg.isStaffReply
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        }`}
      >
        {msg.senderName.charAt(0).toUpperCase()}
      </div>
      <div className={`max-w-[75%] ${msg.isStaffReply ? '' : 'items-end flex flex-col'}`}>
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            msg.isStaffReply
              ? 'bg-muted text-foreground rounded-tl-sm'
              : 'bg-primary text-primary-foreground rounded-tr-sm'
          }`}
        >
          <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        </div>
        <p className="text-xs text-muted-foreground mt-1 px-1">
          {msg.isStaffReply ? (
            <span className="font-medium">{msg.senderName}</span>
          ) : (
            'You'
          )}{' '}
          · {formatDateTime(msg.createdAt)}
        </p>
      </div>
    </div>
  );
}

// ── Ticket detail panel ────────────────────────────────────────────────────────

function TicketDetail({ ticket }: { ticket: SupportTicket }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const { data: detail, isLoading } = useQuery({
    queryKey: ['support-ticket', ticket.id],
    queryFn: () => supportAPI.getTicket(ticket.id),
    initialData: ticket,
  });

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await supportAPI.addMessage(ticket.id, reply.trim());
      setReply('');
      await queryClient.invalidateQueries({ queryKey: ['support-ticket', ticket.id] });
      await queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      toast.success('Reply sent');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const messages = detail?.messages ?? [];
  const attachments = detail?.attachments ?? [];

  return (
    <div className="border-t border-border bg-muted/20 p-5 space-y-5">
      {/* Metadata row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">
            Status
          </p>
          <StatusBadge status={detail?.status ?? ticket.status} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">
            Priority
          </p>
          <PriorityBadge priority={detail?.priority ?? ticket.priority} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">
            Assigned to
          </p>
          <p className="text-sm">
            {detail?.assignedToName ?? ticket.assignedToName ?? 'Unassigned'}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-0.5">
            Category
          </p>
          <p className="text-sm capitalize">{detail?.category ?? ticket.category}</p>
        </div>
      </div>

      {/* Description */}
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1.5">
          Description
        </p>
        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
          {detail?.description ?? ticket.description}
        </p>
      </div>

      {/* Attachments */}
      {attachments.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
            Attachments
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att) => (
              <a
                key={att.id}
                href={att.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2 text-xs hover:border-primary transition-colors"
              >
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="max-w-[120px] truncate">{att.filename}</span>
                <span className="text-muted-foreground">
                  ({formatBytes(att.fileSize)})
                </span>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Message thread */}
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-3">
          Messages {messages.length > 0 && `(${messages.length})`}
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-2">
            No messages yet. Your ticket is being reviewed.
          </p>
        ) : (
          <div className="space-y-4 max-h-80 overflow-y-auto pr-1">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Reply form */}
      {(detail?.status ?? ticket.status) !== 'closed' &&
        (detail?.status ?? ticket.status) !== 'resolved' && (
          <form onSubmit={handleSendReply} className="space-y-2">
            <Textarea
              placeholder="Write a reply..."
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              disabled={sending}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                disabled={sending || !reply.trim()}
              >
                {sending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5 mr-1.5" />
                    Send reply
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
    </div>
  );
}

// ── Ticket card ────────────────────────────────────────────────────────────────

function TicketCard({ ticket }: { ticket: SupportTicket }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-shadow">
      <button
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">
                  {ticket.ticketNumber}
                </span>
                <StatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
                <Badge variant="outline" className="text-xs capitalize">
                  {ticket.category}
                </Badge>
              </div>
              <h3 className="font-semibold text-base leading-snug truncate">
                {ticket.subject}
              </h3>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDate(ticket.createdAt)}
                </span>
                {ticket.messageCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Send className="w-3.5 h-3.5" />
                    {ticket.messageCount} message{ticket.messageCount !== 1 ? 's' : ''}
                  </span>
                )}
                {ticket.assignedToName && (
                  <span className="flex items-center gap-1">
                    <User className="w-3.5 h-3.5" />
                    {ticket.assignedToName}
                  </span>
                )}
              </div>
            </div>
            <div className="shrink-0 text-muted-foreground mt-1">
              {expanded ? (
                <ChevronUp className="w-5 h-5" />
              ) : (
                <ChevronDown className="w-5 h-5" />
              )}
            </div>
          </div>
        </div>
      </button>

      {expanded && <TicketDetail ticket={ticket} />}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export function MyTickets() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useApp();

  const {
    data: tickets = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['support-tickets'],
    queryFn: supportAPI.getTickets,
    enabled: isAuthenticated,
    retry: 1,
  });

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
            <TicketIcon className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-2xl font-semibold mb-2">Sign in to view your tickets</h2>
          <p className="text-muted-foreground text-sm mb-6">
            You need to be signed in to track your support tickets.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => navigate('/login')}>Sign in</Button>
            <Button variant="outline" onClick={() => navigate('/support')}>
              Create a ticket anyway
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-primary py-14 px-4">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-4xl">
          <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
            <div>
              <h1 className="text-3xl font-semibold text-white mb-1">
                My Support Tickets
              </h1>
              <p className="text-white/70 text-sm">
                {isLoading
                  ? 'Loading your tickets...'
                  : tickets.length > 0
                  ? `${tickets.length} ticket${tickets.length !== 1 ? 's' : ''} found`
                  : 'No tickets yet'}
              </p>
            </div>
            <Button
              onClick={() => navigate('/support')}
              variant="secondary"
              className="shrink-0"
            >
              <Plus className="w-4 h-4 mr-2" />
              New ticket
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-8 max-w-4xl">
        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading your tickets...</span>
          </div>
        )}

        {/* Error */}
        {isError && !isLoading && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 text-center">
            <p className="text-sm font-medium text-destructive mb-3">
              Failed to load your tickets.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Try again
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && tickets.length === 0 && (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <TicketIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2">No tickets yet</h2>
            <p className="text-muted-foreground text-sm mb-6">
              When you submit a support request, it will appear here.
            </p>
            <Button onClick={() => navigate('/support')}>
              <Plus className="w-4 h-4 mr-2" />
              Create your first ticket
            </Button>
          </div>
        )}

        {/* Ticket list */}
        {!isLoading && !isError && tickets.length > 0 && (
          <div className="space-y-4">
            {tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} />
            ))}
          </div>
        )}

        {/* Footer help link */}
        {!isLoading && (
          <div className="mt-10 pt-8 border-t border-border text-center">
            <p className="text-sm text-muted-foreground">
              Need help with something else?{' '}
              <a
                href="/contact"
                className="text-primary font-medium hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  navigate('/contact');
                }}
              >
                Contact us
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
