import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChevronRight, Star, CalendarCheck, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { formatCurrency, formatDate } from '../../core/utils';
import { toast } from 'sonner';
import { bookingsAPI } from '../../services/api.service';
import { getErrorMessage, ApiError } from '../../services/api/shared/errors';

// Free reservation review/confirm page. No payment is taken here — under the
// revised flow the guest only pays after the host confirms the reservation
// (see Trips → "Complete payment").
export function Booking() {
  const location = useLocation();
  const navigate = useNavigate();
  const { property, checkIn, checkOut, guests, selectedRoom, roomQuantity, pricing } = location.state || {};

  const [specialRequests, setSpecialRequests] = useState('');
  const [agreedToRules, setAgreedToRules] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [viewingRequired, setViewingRequired] = useState(false);

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">No reservation details found</h2>
          <Button onClick={() => navigate('/')}>Back to Home</Button>
        </div>
      </div>
    );
  }

  const isMonthly = pricing?.pricingType === 'monthly';
  const monthsUpfront = pricing?.monthsUpfront || 1;

  const toISODate = (d: unknown): string =>
    d instanceof Date ? d.toISOString().split('T')[0] : String(d);

  const handleReserve = async () => {
    if (!agreedToRules) {
      toast.error('Please agree to the house rules and cancellation policy');
      return;
    }
    setIsSubmitting(true);
    setViewingRequired(false);
    try {
      const startDate = toISODate(checkIn);
      const endDate = toISODate(checkOut);

      const booking = await bookingsAPI.create({
        listing: property.id,
        start_date: startDate,
        end_date: endDate,
        notes: specialRequests,
        ...(selectedRoom ? { hotel_room: selectedRoom.id } : {}),
      });

      toast.success('Reservation requested! The host will review and confirm shortly.');
      navigate('/booking/confirmed', {
        state: {
          booking: {
            ...booking,
            property,
            checkIn: startDate,
            checkOut: endDate,
            guests: guests || 1,
            roomQuantity: roomQuantity || 1,
          },
          reserved: true,
        },
      });
    } catch (err) {
      const code = err instanceof ApiError ? (err.data as { code?: string } | undefined)?.code : undefined;
      if (code === 'viewing_required') {
        setViewingRequired(true);
      }
      toast.error(getErrorMessage(err) || 'Could not create reservation. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 text-sm hover:text-primary"
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              Back to property
            </button>
          </div>

          <h1 className="text-3xl font-semibold mb-2">Review and reserve</h1>
          <p className="text-muted-foreground mb-8 text-sm">
            Reserving is free. The host reviews your request first — once they confirm, you'll be
            able to pay and your contact details will be shared.
          </p>

          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
            {/* ── Left column (form). On mobile it drops below the summary. ── */}
            <div className="space-y-8 order-2 lg:order-1">
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 flex gap-3">
                <CalendarCheck className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-foreground">How reservations work</p>
                  <ol className="text-muted-foreground mt-1 list-decimal list-inside space-y-1">
                    <li>You reserve now — no charge.</li>
                    <li>The host confirms (within 7 days).</li>
                    <li>You complete payment within 10 days of confirmation.</li>
                    <li>Your booking details &amp; host contact are shared.</li>
                  </ol>
                </div>
              </div>

              <div>
                <h2 className="text-xl font-semibold mb-4">Add a message to the host (optional)</h2>
                <Textarea
                  placeholder="Introduce yourself or share any special requests..."
                  value={specialRequests}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                  rows={4}
                />
              </div>

              <Separator />

              <div>
                <h2 className="text-xl font-semibold mb-4">Ground rules</h2>
                <p className="text-muted-foreground mb-4">
                  We ask every guest to remember a few simple things about what makes a great guest.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside mb-6">
                  <li>Follow the house rules</li>
                  <li>Treat your host's home like your own</li>
                </ul>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedToRules}
                    onChange={(e) => setAgreedToRules(e.target.checked)}
                    className="mt-1"
                  />
                  <span className="text-sm">
                    I agree to the house rules, cancellation policy, and ground rules for guests
                  </span>
                </label>
              </div>

              {viewingRequired && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm">
                  <p className="font-medium text-amber-900 mb-1">A property viewing is required first</p>
                  <p className="text-amber-800 mb-3">
                    Before you can reserve this property, a Home Konet rep needs to walk you through it in
                    person. Schedule and complete a viewing, then come back to reserve.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/rooms/${property.id}/viewing`, { state: { property } })}
                  >
                    Schedule a viewing
                  </Button>
                </div>
              )}

              <Button
                type="button"
                onClick={handleReserve}
                disabled={isSubmitting || !agreedToRules}
                className="w-full"
                size="lg"
              >
                {isSubmitting ? 'Reserving…' : 'Confirm reservation — free'}
              </Button>
            </div>

            {/* ── Right column: summary. On mobile it appears first. ── */}
            <div className="order-1 lg:order-2 lg:sticky lg:top-24">
              <div className="border border-border rounded-xl p-4 sm:p-6 space-y-6">
                <div className="flex gap-4">
                  <img
                    src={property.images?.[0]}
                    alt={property.title}
                    className="w-28 h-20 sm:w-32 sm:h-24 rounded-lg object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground capitalize truncate">{property.propertyType}</p>
                    <h3 className="font-semibold line-clamp-2">{property.title}</h3>
                    <div className="flex items-center gap-1 text-sm mt-1">
                      <Star className="w-3 h-3 fill-current" />
                      <span className="font-semibold">{property.rating?.toFixed(2) || '—'}</span>
                      <span className="text-muted-foreground">({property.reviewCount || 0} reviews)</span>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h2 className="text-lg font-semibold">Your reservation</h2>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">Dates</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(checkIn, 'MMM dd')} – {formatDate(checkOut, 'MMM dd, yyyy')}
                      </p>
                    </div>
                    <Button variant="link" className="p-0 h-auto text-sm" onClick={() => navigate(-1)}>
                      Edit
                    </Button>
                  </div>
                  {selectedRoom && (
                    <p className="text-sm text-muted-foreground">Room: {selectedRoom.name}</p>
                  )}
                </div>

                <Separator />

                {pricing && (
                  <div>
                    <h2 className="text-lg font-semibold mb-1">You'll pay after confirmation</h2>
                    <p className="text-xs text-muted-foreground mb-4">Not charged now.</p>
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span>
                          {isMonthly
                            ? `First ${monthsUpfront} month${monthsUpfront > 1 ? 's' : ''}`
                            : `Stay subtotal`}
                        </span>
                        <span>{formatCurrency(pricing.subtotal)}</span>
                      </div>
                      {pricing.discount > 0 && (
                        <div className="flex justify-between text-green-700">
                          <span>{pricing.discountLabel || 'Discount'}</span>
                          <span>-{formatCurrency(pricing.discount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Service fee</span>
                        <span>{formatCurrency(pricing.serviceFee)}</span>
                      </div>
                    </div>
                    <Separator className="my-4" />
                    <div className="flex justify-between font-semibold text-base">
                      <span>Total when you pay</span>
                      <span>{formatCurrency(pricing.total)}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3 p-4 bg-secondary/30 rounded-lg">
                  <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
                  <div className="text-sm">
                    <p className="font-semibold">No charge to reserve</p>
                    <p className="text-muted-foreground">You only pay once the host confirms your reservation.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
