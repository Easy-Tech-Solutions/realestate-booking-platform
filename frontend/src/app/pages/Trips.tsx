import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, Users, Star, AlertCircle, ShieldAlert } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { formatCurrency, formatDate } from '../../core/utils';
import { useNavigate } from 'react-router';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';
import { Booking } from '../../core/types';
import { bookingStatusMeta } from '../../core/bookingStatus';
import { useUserTrips } from '../../hooks/queries/useTrips';
import { aircoverClaimsAPI } from '../../services/api/aircoverClaims';

const CLAIM_TYPES: { value: string; label: string }[] = [
  { value: 'property_damage', label: 'Property damage' },
  { value: 'missing_items', label: 'Missing items' },
  { value: 'cleanliness', label: 'Cleanliness' },
  { value: 'safety', label: 'Safety issue' },
  { value: 'other', label: 'Other' },
];

export function Trips() {
  const navigate = useNavigate();
  const { isAuthenticated } = useApp();
  const { upcomingTrips, pastTrips, isLoading, isError, cancelMutation, reviewMutation } = useUserTrips(isAuthenticated);

  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Booking | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');

  const [claimTarget, setClaimTarget] = useState<Booking | null>(null);
  const [claimType, setClaimType] = useState('property_damage');
  const [claimDescription, setClaimDescription] = useState('');
  const [claimAmount, setClaimAmount] = useState('');
  const [claimSubmitting, setClaimSubmitting] = useState(false);

  useEffect(() => {
    if (isError) {
      toast.error('Failed to load your bookings');
    }
  }, [isError]);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelMutation.mutateAsync(cancelTarget.id);
      toast.success('Booking cancelled successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to cancel booking');
    }
    setCancelTarget(null);
  };

  const handleSubmitReview = async () => {
    if (!reviewText.trim()) {
      toast.error('Please write a review');
      return;
    }
    try {
      await reviewMutation.mutateAsync({ listingId: reviewTarget!.propertyId, rating: reviewRating, content: reviewText });
      toast.success('Review submitted — thank you!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit review');
    }
    setReviewTarget(null);
    setReviewText('');
    setReviewRating(5);
  };

  const closeClaimDialog = () => {
    setClaimTarget(null);
    setClaimType('property_damage');
    setClaimDescription('');
    setClaimAmount('');
  };

  const handleSubmitClaim = async () => {
    if (!claimTarget) return;
    if (!claimDescription.trim()) {
      toast.error('Please describe what happened');
      return;
    }
    const amount = Number(claimAmount);
    if (!claimAmount || Number.isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid requested amount');
      return;
    }
    setClaimSubmitting(true);
    try {
      await aircoverClaimsAPI.file({
        booking: Number(claimTarget.id),
        claim_type: claimType,
        description: claimDescription.trim(),
        requested_amount: claimAmount,
      });
      toast.success('Claim submitted — our team will review it and follow up.');
      closeClaimDialog();
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit claim');
    } finally {
      setClaimSubmitting(false);
    }
  };

  const TripCard = ({ trip, isPast }: { trip: (typeof upcomingTrips)[number]; isPast?: boolean }) => (
    <div className="border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow">
      <div className="grid sm:grid-cols-3 gap-4 sm:gap-6 p-4 sm:p-6">
        <img
          src={trip.property.images[0]}
          alt={trip.property.title}
          className="w-full h-48 md:h-full object-cover rounded-lg"
        />
        <div className="md:col-span-2 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${bookingStatusMeta(trip.booking.status).className}`}>
                {bookingStatusMeta(trip.booking.status).label}
              </span>
            </div>
            <h3 className="text-xl font-semibold mb-2">{trip.property.title}</h3>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {trip.property.location.city}, {trip.property.location.state}
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                {trip.booking.guests} guest{trip.booking.guests > 1 ? 's' : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4" />
            <span>
              {formatDate(trip.booking.checkIn, 'MMM dd')} – {formatDate(trip.booking.checkOut, 'MMM dd, yyyy')}
            </span>
          </div>

          {trip.booking.status === 'awaiting_payment' && (
            <div className="rounded-lg bg-blue-50 text-blue-800 text-sm px-3 py-2">
              Your host confirmed this reservation. Complete payment
              {typeof trip.booking.daysUntilExpiry === 'number'
                ? ` within ${trip.booking.daysUntilExpiry} day${trip.booking.daysUntilExpiry === 1 ? '' : 's'}`
                : ' soon'}{' '}
              to secure it.
            </div>
          )}
          {trip.booking.status === 'pending_host' && (
            <div className="rounded-lg bg-yellow-50 text-yellow-800 text-sm px-3 py-2">
              Waiting for the host to confirm your reservation.
            </div>
          )}
          {trip.booking.status === 'payment_received' && (
            <div className="rounded-lg bg-indigo-50 text-indigo-800 text-sm px-3 py-2">
              Payment received — we're confirming it. Your host's contact will be shared once confirmed.
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-border">
            <div>
              <p className="text-sm text-muted-foreground">Total price</p>
              <p className="text-xl font-semibold">{formatCurrency(trip.estimatedTotal)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!isPast && trip.booking.status === 'awaiting_payment' && (
                <Button
                  onClick={() =>
                    navigate(`/booking/${trip.booking.id}/pay`, {
                      state: { booking: { ...trip.booking, property: trip.property } },
                    })
                  }
                >
                  Complete payment
                </Button>
              )}
              {!isPast && trip.booking.status !== 'cancelled' && (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCancelTarget(trip.booking)}>
                  Cancel
                </Button>
              )}
              {isPast && trip.booking.status === 'completed' && (
                <Button variant="outline" onClick={() => setReviewTarget(trip.booking)}>
                  <Star className="w-4 h-4 mr-1" /> Review
                </Button>
              )}
              {(trip.booking.status === 'completed' || trip.booking.status === 'confirmed') && (
                <Button variant="outline" onClick={() => setClaimTarget(trip.booking)}>
                  <ShieldAlert className="w-4 h-4 mr-1" /> File a claim
                </Button>
              )}
              <Button variant={trip.booking.status === 'awaiting_payment' ? 'outline' : 'default'} onClick={() => navigate(`/rooms/${trip.property.id}`)}>
                {isPast ? 'Book again' : 'View details'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const EmptyState = ({ message, sub }: { message: string; sub: string }) => (
    <div className="text-center py-20">
      <h2 className="text-2xl font-semibold mb-2">{message}</h2>
      <p className="text-muted-foreground mb-6">{sub}</p>
      <Button onClick={() => navigate('/')}>Start searching</Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-8">
          <h1 className="text-3xl font-semibold">My Bookings</h1>
          <button
            className="text-sm text-primary underline underline-offset-2"
            onClick={() => navigate('/viewings')}
          >
            Looking for a property viewing? See My Viewings →
          </button>
        </div>

        {isLoading && <p className="text-muted-foreground mb-6">Loading your bookings...</p>}

        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList className="mb-8">
            <TabsTrigger value="upcoming">
              Upcoming {upcomingTrips.length > 0 && `(${upcomingTrips.length})`}
            </TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="space-y-6">
            {upcomingTrips.length > 0 ? (
              upcomingTrips.map(trip => <TripCard key={trip.booking.id} trip={trip} />)
            ) : (
              <EmptyState
                message="No bookings yet!"
                sub="Browse our listings and make your first booking today"
              />
            )}
          </TabsContent>

          <TabsContent value="past" className="space-y-6">
            {pastTrips.length > 0 ? (
              pastTrips.map(trip => <TripCard key={trip.booking.id} trip={trip} isPast />)
            ) : (
              <EmptyState
                message="No past bookings"
                sub="Your completed bookings will appear here"
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Cancel confirmation dialog */}
      <Dialog open={!!cancelTarget} onOpenChange={() => setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              Cancel booking
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to cancel your stay at{' '}
              <strong>{cancelTarget?.property.title}</strong>? Refunds depend on the host's cancellation policy.
            </p>
            <div className="flex gap-2">
              <Button variant="destructive" onClick={handleCancel}>Yes, cancel booking</Button>
              <Button variant="outline" onClick={() => setCancelTarget(null)}>Keep booking</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={() => setReviewTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave a review</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{reviewTarget?.property.title}</p>
            <div>
              <p className="text-sm font-medium mb-2">Rating</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setReviewRating(n)}
                    aria-label={`Rate ${n} star${n > 1 ? 's' : ''}`}
                    title={`Rate ${n} star${n > 1 ? 's' : ''}`}
                  >
                    <Star className={`w-7 h-7 transition-colors ${n <= reviewRating ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              placeholder="Share your experience..."
              value={reviewText}
              onChange={e => setReviewText(e.target.value)}
              rows={4}
            />
            <div className="flex gap-2">
              <Button onClick={handleSubmitReview}>Submit review</Button>
              <Button variant="outline" onClick={() => setReviewTarget(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* AirCover claim dialog */}
      <Dialog open={!!claimTarget} onOpenChange={(open) => !open && closeClaimDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-primary" />
              File an AirCover claim
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {claimTarget?.property.title} — our team reviews every claim and follows up; approving a claim
              doesn't issue payment automatically, so expect to hear from us with next steps.
            </p>
            <div className="space-y-1.5">
              <Label>What happened?</Label>
              <Select value={claimType} onValueChange={setClaimType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLAIM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-description">Description</Label>
              <Textarea
                id="claim-description"
                placeholder="Describe what happened in as much detail as you can..."
                value={claimDescription}
                onChange={(e) => setClaimDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="claim-amount">Requested amount (USD)</Label>
              <Input
                id="claim-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={claimAmount}
                onChange={(e) => setClaimAmount(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSubmitClaim} disabled={claimSubmitting}>
                {claimSubmitting ? 'Submitting…' : 'Submit claim'}
              </Button>
              <Button variant="outline" onClick={closeClaimDialog}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
