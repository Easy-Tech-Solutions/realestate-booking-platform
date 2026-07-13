import { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsAPI } from '../../services/api/bookings';
import { Button } from './ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from './ui/dialog';
import { getErrorMessage } from '../../services/api/shared/errors';

interface CommsMessage {
  id: number;
  sender_username: string;
  content: string;
  created_at: string;
}

export function CommunicationsDialog({ bookingId }: { bookingId: string | number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<CommsMessage[]>([]);
  const [guest, setGuest] = useState('');
  const [host, setHost] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await bookingsAPI.adminGetCommunications(bookingId);
      setMessages(data.messages);
      setGuest(data.guest_username);
      setHost(data.host_username);
      setLoaded(true);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load communications'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v && !loaded) load(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageSquare className="h-3.5 w-3.5 mr-1" /> Messages
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Booking #{bookingId} communications</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages between {guest || 'the guest'} and {host || 'the host'} for this listing.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {messages.map((m) => (
              <div key={m.id} className={`p-2.5 rounded-lg text-sm max-w-[85%] ${m.sender_username === host ? 'bg-primary/10 ml-auto' : 'bg-muted'}`}>
                <p className="text-xs font-medium text-muted-foreground mb-0.5">
                  {m.sender_username} · {new Date(m.created_at).toLocaleString()}
                </p>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
