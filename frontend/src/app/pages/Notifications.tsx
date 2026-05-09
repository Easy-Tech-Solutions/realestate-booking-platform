import React, { useEffect, useState } from 'react';
import {
  Bell, Calendar, CheckCheck, MessageSquare, Star, Heart,
  ShieldAlert, DollarSign, Trash2, Circle, CheckCircle2, Loader2,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../../core/utils';
import { notificationsAPI } from '../../services/api.service';
import { toast } from 'sonner';
import { formatDistanceToNow, parseISO } from 'date-fns';

interface ApiNotification {
  id: string;
  notification_type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

function typeToCategory(t: string): 'booking' | 'message' | 'review' | 'payment' | 'system' {
  if (t.startsWith('booking')) return 'booking';
  if (t === 'new_message') return 'message';
  if (t === 'new_review') return 'review';
  if (t.startsWith('payment')) return 'payment';
  return 'system';
}

const iconMap = {
  booking: Calendar,
  message: MessageSquare,
  review: Star,
  payment: DollarSign,
  system: Bell,
  wishlist: Heart,
  report: ShieldAlert,
} as const;

const colorMap: Record<string, string> = {
  booking: 'bg-primary/10 text-primary',
  message: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  review: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
  payment: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-500',
  system: 'bg-muted text-muted-foreground',
};

export function Notifications() {
  const [notifications, setNotifications] = useState<ApiNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    notificationsAPI.getAll()
      .then((data: any) => setNotifications(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load notifications'))
      .finally(() => setLoading(false));
  }, []);

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusy(prev => new Set(prev).add(id));
    try { await fn(); } finally { setBusy(prev => { const s = new Set(prev); s.delete(id); return s; }); }
  };

  const handleToggleRead = async (n: ApiNotification) => {
    await withBusy(n.id, async () => {
      try {
        const updated: any = n.is_read
          ? await notificationsAPI.markUnread(n.id)
          : await notificationsAPI.markRead(n.id);
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, ...updated } : x));
      } catch {
        toast.error('Failed to update notification');
      }
    });
  };

  const handleDelete = async (id: string) => {
    await withBusy(id, async () => {
      try {
        await notificationsAPI.deleteOne(id);
        setNotifications(prev => prev.filter(x => x.id !== id));
        toast.success('Notification deleted');
      } catch {
        toast.error('Failed to delete notification');
      }
    });
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      toast.success('All notifications marked as read');
    } catch {
      toast.error('Failed to mark all as read');
    }
  };

  const filtered = filter === 'unread' ? notifications.filter(n => !n.is_read) : notifications;
  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-3xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-semibold">Notifications</h1>
            {unreadCount > 0 && (
              <p className="text-muted-foreground text-sm mt-1">{unreadCount} unread</p>
            )}
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
              <CheckCheck className="w-4 h-4 mr-2" /> Mark all read
            </Button>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {(['all', 'unread'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                filter === f ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {f === 'all' ? 'All' : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Bell className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">
              {filter === 'unread' ? 'All caught up!' : 'No notifications yet'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(n => {
              const cat = typeToCategory(n.notification_type);
              const Icon = iconMap[cat] ?? Bell;
              const isBusy = busy.has(n.id);
              const timeAgo = (() => {
                try { return formatDistanceToNow(parseISO(n.created_at), { addSuffix: true }); }
                catch { return ''; }
              })();

              return (
                <div
                  key={n.id}
                  className={cn(
                    'flex items-start gap-4 p-4 rounded-xl border transition-colors group',
                    n.is_read
                      ? 'border-border bg-background'
                      : 'border-primary/20 bg-primary/5 dark:bg-primary/10'
                  )}
                >
                  {/* Icon */}
                  <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', colorMap[cat] ?? colorMap.system)}>
                    <Icon className="w-5 h-5" />
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn('font-medium text-sm leading-snug', !n.is_read && 'text-foreground')}>{n.title}</p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">{timeAgo}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{n.message}</p>

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleToggleRead(n)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        {isBusy
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : n.is_read
                            ? <Circle className="w-3.5 h-3.5" />
                            : <CheckCircle2 className="w-3.5 h-3.5" />
                        }
                        {n.is_read ? 'Mark unread' : 'Mark read'}
                      </button>
                      <span className="text-muted-foreground/40">·</span>
                      <button
                        type="button"
                        onClick={() => handleDelete(n.id)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Unread dot */}
                  {!n.is_read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
