import React, { useState, useEffect } from 'react';
import { Calendar, MapPin, Users, Star, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Textarea } from '../components/ui/textarea';
import { formatCurrency, formatDate } from '../../core/utils';
import { useNavigate } from 'react-router';
import { useApp } from '../../core/context';
import { bookingsAPI, reviewsAPI } from '../../services/api.service';
import { toast } from 'sonner';
import { Booking } from '../../core/types';

export function Trips() {
  const navigate = useNavigate();
  const { bookings, cancelBooking, isAuthenticated } = useApp();

  useEffect(() => {
    if (!isAuthenticated) return;
    bookingsAPI.getUserBookings().catch(() => {});
  }, [isAuthenticated]);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [reviewTarget, setReviewTarget] = useState<Booking | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');

  const upcoming = bookings.filter(b => b.status === 'confirmed' || b.status === 'pending');
  const past = bookings.filter(b => b.status === 'completed' || b.status === 'cancelled');

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await bookingsAPI.cancel(cancelTarget.id);
      cancelBooking(cancelTarget.id);
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
      await reviewsAPI.create({
        listing: reviewTarget!.propertyId,
        rating: reviewRating,
        content: reviewText,
      });
      toast.success('Review submitted — thank you!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit review');
    }
    setReviewTarget(null);
    setReviewText('');
    setReviewRating(5);
  };

  const TripCard = ({ trip, isPast }: { trip: Booking; isPast?: boolean }) => (
    <div className="border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow">
      <div className="grid md:grid-cols-3 gap-6 p-6">
        <img
          src={trip.property.images[0]}
          alt={trip.property.title}
          className="w-full h-48 md:h-full object-cover rounded-lg"
        />
        <div className="md:col-span-2 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                trip.status === 'confirmed' ? 'bg-primary/10 text-primary' :
                trip.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                trip.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                'bg-gray-100 text-gray-600'
              }`}>
                {trip.status}
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
                {trip.guests} guest{trip.guests > 1 ? 's' : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4" />
            <span>
              {formatDate(trip.checkIn, 'MMM dd')} – {formatDate(trip.checkOut, 'MMM dd, yyyy')}
            </span>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border">
            <div>
              <p className="text-sm text-muted-foreground">Total price</p>
              <p className="text-xl font-semibold">{formatCurrency(trip.totalPrice)}</p>
            </div>
            <div className="flex gap-2">
              {!isPast && trip.status !== 'cancelled' && (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCancelTarget(trip)}>
                  Cancel
                </Button>
              )}
              {isPast && trip.status === 'completed' && (
                <Button variant="outline" onClick={() => setReviewTarget(trip)}>
                  <Star className="w-4 h-4 mr-1" /> Review
                </Button>
              )}
              <Button onClick={() => navigate(`/rooms/${trip.property.id}`)}>
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
        <h1 className="text-3xl font-semibold mb-8">Trips</h1>

        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList className="mb-8">
            <TabsTrigger value="upcoming">
              Upcoming {upcoming.length > 0 && `(${upcoming.length})`}
            </TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="space-y-6">
            {upcoming.length > 0 ? (
              upcoming.map(trip => <TripCard key={trip.id} trip={trip} />)
            ) : (
              <EmptyState
                message="No trips booked...yet!"
                sub="Time to dust off your bags and start planning your next adventure"
              />
            )}
          </TabsContent>

          <TabsContent value="past" className="space-y-6">
            {past.length > 0 ? (
              past.map(trip => <TripCard key={trip.id} trip={trip} isPast />)
            ) : (
              <EmptyState
                message="No past trips"
                sub="Your past trips will appear here"
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
                  <button key={n} onClick={() => setReviewRating(n)}>
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
    </div>
  );
}
