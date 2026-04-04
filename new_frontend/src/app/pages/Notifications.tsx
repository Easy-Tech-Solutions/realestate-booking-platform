import React, { useState } from 'react';
import { Bell, Calendar, Heart, MessageSquare, Star, CheckCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { cn } from '../../core/utils';

type NotifType = 'booking' | 'message' | 'review' | 'wishlist' | 'system';

interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  time: string;
  read: boolean;
}

const iconMap: Record<NotifType, React.ElementType> = {
  booking: Calendar,
  message: MessageSquare,
  review: Star,
  wishlist: Heart,
  system: Bell,
};

const colorMap: Record<NotifType, string> = {
  booking: 'bg-primary/10 text-primary',
  message: 'bg-blue-100 text-blue-600',
  review: 'bg-yellow-100 text-yellow-600',
  wishlist: 'bg-red-100 text-red-500',
  system: 'bg-gray-100 text-gray-600',
};

const initialNotifications: Notification[] = [
  { id: '1', type: 'booking', title: 'Booking Confirmed', body: 'Your stay at Luxurious Beachfront Villa is confirmed for May 10–15.', time: '2 hours ago', read: false },
  { id: '2', type: 'message', title: 'New Message', body: 'Sarah Smith sent you a message about your upcoming stay.', time: '5 hours ago', read: false },
  { id: '3', type: 'review', title: 'New Review', body: 'Mike Johnson left a 5-star review for your property.', time: '1 day ago', read: false },
  { id: '4', type: 'booking', title: 'Booking Request', body: 'You have a new booking request for Cozy Mountain Cabin.', time: '2 days ago', read: true },
  { id: '5', type: 'wishlist', title: 'Price Drop Alert', body: 'A property in your wishlist dropped in price by 15%.', time: '3 days ago', read: true },
  { id: '6', type: 'system', title: 'Account Verified', body: 'Your identity has been successfully verified.', time: '1 week ago', read: true },
  { id: '7', type: 'review', title: 'Review Reminder', body: 'How was your stay at Modern Downtown Loft? Leave a review.', time: '1 week ago', read: true },
  { id: '8', type: 'booking', title: 'Check-in Tomorrow', body: 'Reminder: Your check-in at Tropical Paradise is tomorrow at 3:00 PM.', time: '2 weeks ago', read: true },
];

export function Notifications() {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const markAllRead = () => setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id: string) => setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

  const filtered = filter === 'unread' ? notifications.filter(n => !n.read) : notifications;
  const unreadCount = notifications.filter(n => !n.read).length;

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
            <Button variant="outline" size="sm" onClick={markAllRead}>
              <CheckCheck className="w-4 h-4 mr-2" /> Mark all read
            </Button>
          )}
        </div>

        <div className="flex gap-2 mb-6">
          {(['all', 'unread'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                filter === f ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {f === 'all' ? 'All' : 'Unread'}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.length === 0 ? (
            <div className="text-center py-20">
              <Bell className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No notifications</p>
            </div>
          ) : (
            filtered.map(n => {
              const Icon = iconMap[n.type];
              return (
                <button
                  key={n.id}
                  onClick={() => markRead(n.id)}
                  className={cn(
                    'w-full flex items-start gap-4 p-4 rounded-xl border transition-colors text-left',
                    n.read ? 'border-border bg-background' : 'border-primary/20 bg-primary/5'
                  )}
                >
                  <div className={cn('w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0', colorMap[n.type])}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={cn('font-medium text-sm', !n.read && 'text-foreground')}>{n.title}</p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{n.time}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">{n.body}</p>
                  </div>
                  {!n.read && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
