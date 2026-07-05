import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Home } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { formatDate, formatCurrency } from '../../core/utils';
import { toast } from 'sonner';
import type { ViewingAppointment } from '../../core/types';
import { viewingsAPI } from '../../services/api.service';
import { useApp } from '../../hooks/useApp';
import { getErrorMessage } from '../../services/api/shared/errors';

const VIEWING_STATUS: Record<string, { label: string; className: string }> = {
  requested: { label: 'Awaiting fee payment', className: 'bg-yellow-100 text-yellow-700' },
  fee_paid: { label: 'Fee paid — scheduling', className: 'bg-blue-100 text-blue-700' },
  scheduled: { label: 'Scheduled', className: 'bg-indigo-100 text-indigo-700' },
  completed: { label: 'Visit complete', className: 'bg-primary/10 text-primary' },
  reserved: { label: 'Reserved', className: 'bg-primary/10 text-primary' },
  cancelled: { label: 'Cancelled', className: 'bg-red-100 text-red-600' },
  expired: { label: 'Expired', className: 'bg-gray-100 text-gray-600' },
};

export function Viewings() {
  const navigate = useNavigate();
  const { isAuthenticated } = useApp();
  const viewingsQuery = useQuery({
    queryKey: ['viewings', 'mine'],
    queryFn: () => viewingsAPI.getMine(),
    enabled: isAuthenticated,
  });

  const [reserveTarget, setReserveTarget] = useState<ViewingAppointment | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isReserving, setIsReserving] = useState(false);

  const viewings = viewingsQuery.data || [];

  const handleReserve = async () => {
    if (!reserveTarget) return;
    if (!startDate || !endDate) {
      toast.error('Please choose your lease start and end dates');
      return;
    }
    if (startDate >= endDate) {
      toast.error('End date must be after start date');
      return;
    }
    setIsReserving(true);
    try {
      const booking = await viewingsAPI.reserve(reserveTarget.id, { start_date: startDate, end_date: endDate });
      toast.success('Property reserved! Complete payment within 10 days to secure it.');
      setReserveTarget(null);
      navigate(`/booking/${booking.id}/pay`, { state: { booking } });
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Could not reserve. Please try again.');
    } finally {
      setIsReserving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <h1 className="text-3xl font-semibold mb-2">My Viewings</h1>
        <p className="text-muted-foreground mb-8 text-sm">
          Property viewings you've requested. After a completed visit you can reserve the property.
        </p>

        {viewingsQuery.isLoading && <p className="text-muted-foreground">Loading…</p>}

        {!viewingsQuery.isLoading && viewings.length === 0 && (
          <div className="text-center py-20">
            <h2 className="text-2xl font-semibold mb-2">No viewings yet</h2>
            <p className="text-muted-foreground mb-6">Request a viewing on a long-term rental to see it here.</p>
            <Button onClick={() => navigate('/')}>Browse properties</Button>
          </div>
        )}

        <div className="space-y-4">
          {viewings.map((v) => {
            const meta = VIEWING_STATUS[v.status] || { label: v.statusDisplay, className: 'bg-gray-100 text-gray-600' };
            return (
              <div key={v.id} className="border border-border rounded-xl p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.className}`}>{meta.label}</span>
                    </div>
                    <h3 className="text-lg font-semibold">{v.listingTitle}</h3>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                      <CalendarDays className="w-4 h-4" />
                      {formatDate(v.viewingDate, 'EEEE, MMM dd, yyyy')}
                      {v.viewingTimeRange ? ` · ${v.viewingTimeRange}` : ''}
                    </div>
                    {!v.isFeePaid && v.status === 'requested' && (
                      <p className="text-sm text-yellow-700 mt-2">
                        Fee not paid yet ({formatCurrency(v.viewingFee)}). Re-request to pay.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {v.status === 'completed' && !v.bookingId && (
                      <Button onClick={() => { setReserveTarget(v); setStartDate(''); setEndDate(''); }}>
                        <Home className="w-4 h-4 mr-1" /> Reserve property
                      </Button>
                    )}
                    {v.bookingId && (
                      <Button variant="outline" onClick={() => navigate('/trips')}>View reservation</Button>
                    )}
                    <Button variant="outline" onClick={() => navigate(`/rooms/${v.listingId}`)}>View property</Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={!!reserveTarget} onOpenChange={(open) => !open && setReserveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reserve {reserveTarget?.listingTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose your lease dates. The property will be held for 10 days while you complete payment.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="start">Lease start</Label>
                <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="end">Lease end</Label>
                <Input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReserveTarget(null)}>Cancel</Button>
              <Button onClick={handleReserve} disabled={isReserving}>
                {isReserving ? 'Reserving…' : 'Reserve & continue to payment'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
