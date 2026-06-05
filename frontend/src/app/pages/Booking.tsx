import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Smartphone, Wallet, ChevronRight, Shield, Star, BedDouble, Users } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Textarea } from '../components/ui/textarea';
import { formatCurrency, formatDate } from '../../core/utils';
import { toast } from 'sonner';
import { PaymentMethod } from '../../core/types';
import { bookingsAPI, paymentAPI } from '../../services/api.service';
import { fetchWithAuth } from '../../services/api/shared/client';

// MTN MoMo is async — after we kick off the request-to-pay, the user has to
// approve the prompt on their phone. We poll the verify endpoint until the
// payment either completes or the user declines / it times out. Numbers
// chosen so a real-world approval (3-15s) feels responsive, while a stuck
// request gives up gracefully instead of hanging the UI forever.
const MOMO_POLL_INTERVAL_MS = 3000;
const MOMO_POLL_TIMEOUT_MS = 3 * 60 * 1000;  // 3 minutes

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
// Stripe keys must start with pk_test_ or pk_live_ followed by at least 20 chars.
// Guard against placeholder values like "pk_test_your_stripe_publishable_key_here".
const isValidStripeKey = (key?: string): key is string =>
  !!key && /^pk_(test|live)_[a-zA-Z0-9]{20,}$/.test(key);
const stripePromise = isValidStripeKey(STRIPE_KEY) ? loadStripe(STRIPE_KEY) : null;

function BookingForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const { property, checkIn, checkOut, guests, pricing, selectedRoom, roomQuantity: stateRoomQuantity } = location.state || {};

  const stripe = useStripe();
  const elements = useElements();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [agreedToRules, setAgreedToRules] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // MoMo-specific async state. 'awaiting' is shown while we poll for the
  // user to approve the prompt on their phone.
  const [momoStatus, setMomoStatus] = useState<'idle' | 'awaiting'>('idle');

  const BOOKING_FEE = 3;

  const currentProperty = property;
  const currentCheckIn = checkIn;
  const currentCheckOut = checkOut;
  const currentGuests = guests || 1;
  const currentRoomQuantity = stateRoomQuantity || 1;
  const currentPricing = pricing || { subtotal: 0, cleaningFee: 0, serviceFee: 0, taxes: 0, total: 0 };

  // For hotels with multiple rooms, multiply subtotal by room quantity
  const baseSubtotal = (currentPricing.subtotal || 0) * currentRoomQuantity;
  const baseServiceFee = (currentPricing.serviceFee || 0) * currentRoomQuantity;

  // Remove cleaning fee & taxes; add flat $3 booking fee
  const displayTotal = baseSubtotal + baseServiceFee + BOOKING_FEE;

  if (!currentProperty) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">No booking details found</h2>
          <Button onClick={() => navigate('/')}>Back to Home</Button>
        </div>
      </div>
    );
  }

  const handlePayment = async () => {
    if (!agreedToRules) {
      toast.error('Please agree to the house rules and cancellation policy');
      return;
    }
    if (paymentMethod === 'mtn_momo' && !phoneNumber) {
      toast.error('Please enter your phone number');
      return;
    }
    if (paymentMethod === 'stripe' && !stripePromise) {
      toast.error('Stripe is not configured. Please contact support.');
      return;
    }
    if (paymentMethod === 'stripe' && (!stripe || !elements)) {
      toast.error('Stripe has not finished loading. Please wait a moment and try again.');
      return;
    }

    setIsProcessing(true);
    let stripePaymentIntentId: string | undefined;
    try {
      const startDate = currentCheckIn instanceof Date
        ? currentCheckIn.toISOString().split('T')[0]
        : currentCheckIn;
      const endDate = currentCheckOut instanceof Date
        ? currentCheckOut.toISOString().split('T')[0]
        : currentCheckOut;

      if (paymentMethod === 'stripe') {
        let clientSecret: string;
        try {
          const result = await fetchWithAuth<{ client_secret: string; amount_cents: number }>(
            '/api/payments/stripe/payment-intent/',
            {
              method: 'POST',
              body: JSON.stringify({
                listing_id: currentProperty.id,
                check_in:   startDate,
                check_out:  endDate,
                ...(selectedRoom ? { room_id: selectedRoom.id } : {}),
                currency: 'usd',
              }),
            }
          );
          clientSecret = result.client_secret;
        } catch (piErr: any) {
          toast.error(piErr.message || 'Could not initialise payment. Please try again.');
          return;
        }

        const cardElement = elements!.getElement(CardElement);
        if (!cardElement) {
          toast.error('Card element not found. Please refresh and try again.');
          return;
        }

        let confirmError: { message?: string } | undefined;
        let confirmedPaymentIntentId: string | undefined;
        try {
          const result = await stripe!.confirmCardPayment(clientSecret, {
            payment_method: { card: cardElement },
          });
          confirmError = result.error;
          confirmedPaymentIntentId = result.paymentIntent?.id;
        } catch {
          toast.error('Card payment failed — please check your card details and try again.');
          return;
        }

        if (confirmError) {
          toast.error(confirmError.message || 'Card payment failed');
          return;
        }

        if (!confirmedPaymentIntentId) {
          toast.error('Payment completed but could not retrieve payment ID. Please contact support.');
          return;
        }

        stripePaymentIntentId = confirmedPaymentIntentId;
      }

      const booking = await bookingsAPI.create({
        listing: currentProperty.id,
        start_date: startDate,
        end_date: endDate,
        notes: specialRequests,
        payment_method: paymentMethod === 'mtn_momo' ? 'mtn_momo' : 'stripe',
        ...(selectedRoom ? { hotel_room: selectedRoom.id } : {}),
        ...(stripePaymentIntentId ? { stripe_payment_intent_id: stripePaymentIntentId } : {}),
      });

      // MTN MoMo: send a request-to-pay push, then poll for the user's
      // approval. Until this completes we don't let them onto the
      // confirmation page — no payment, no confirmation.
      if (paymentMethod === 'mtn_momo') {
        const payment = await paymentAPI.initiateMomoPayment(booking.id, phoneNumber);
        const paymentId = payment?.id || payment?.payment?.id;
        if (!paymentId) {
          toast.error('Could not start MoMo payment. Please try again.');
          return;
        }

        setMomoStatus('awaiting');
        toast.info('Check your phone — approve the MoMo prompt to complete the booking.', {
          duration: 8000,
        });

        const started = Date.now();
        let confirmed = false;
        while (Date.now() - started < MOMO_POLL_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, MOMO_POLL_INTERVAL_MS));
          try {
            const result = await paymentAPI.verifyPayment(paymentId);
            const status = result?.payment?.status || result?.status;
            if (status === 'completed') {
              confirmed = true;
              break;
            }
            if (status === 'failed') {
              toast.error('Payment was declined or failed. Please try again.');
              return;
            }
          } catch {
            // Transient verify error — keep polling until the overall timeout.
          }
        }

        if (!confirmed) {
          toast.error('Payment timed out. You can retry from this page.');
          return;
        }
      }

      const confirmedBooking = {
        ...booking,
        property: currentProperty,
        checkIn: startDate,
        checkOut: endDate,
        guests: currentGuests,
        roomQuantity: currentRoomQuantity,
        totalPrice: displayTotal,
        basePrice: baseSubtotal,
        cleaningFee: 0,
        serviceFee: baseServiceFee,
        bookingFee: BOOKING_FEE,
        taxes: 0,
        paymentMethod,
      };

      toast.success(paymentMethod === 'mtn_momo' ? 'Payment received!' : 'Booking requested!');
      navigate('/booking/confirmed', {
        state: { booking: confirmedBooking },
      });
    } catch (err: any) {
      toast.error(err.message || 'Booking failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setMomoStatus('idle');
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <div className="max-w-6xl mx-auto">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm mb-6 hover:text-primary"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back
          </button>

          <h1 className="text-3xl font-semibold mb-8">Confirm and pay</h1>

          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">

            {/* ── Left column: payment form ── */}
            <div className="space-y-8">

              {/* Choose how to pay */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Choose how to pay</h2>
                <RadioGroup
                  value={paymentMethod}
                  onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}
                >
                  <div className="space-y-3">
                    <label
                      htmlFor="stripe"
                      className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30"
                    >
                      <RadioGroupItem value="stripe" id="stripe" />
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#635BFF"/><path d="M11.2 9.5c0-.8.7-1.1 1.8-1.1 1.6 0 3.6.5 5 1.3V6.2C16.7 5.4 14.8 5 12.9 5 9.5 5 7 6.8 7 10c0 4.9 6.7 4.1 6.7 6.2 0 1-.8 1.3-1.9 1.3-1.7 0-3.8-.7-5.5-1.6v3.6C7.7 20.4 9.8 21 12 21c3.5 0 6.1-1.7 6.1-5-.1-5.3-6.9-4.3-6.9-6.5z" fill="white"/></svg>
                      <div>
                        <p className="font-semibold">Credit or Debit Card</p>
                        <p className="text-sm text-muted-foreground">Visa, Mastercard, Amex</p>
                      </div>
                    </label>

                    <label
                      htmlFor="paypal"
                      className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30"
                    >
                      <RadioGroupItem value="paypal" id="paypal" />
                      <Wallet className="w-5 h-5" />
                      <div>
                        <p className="font-semibold">PayPal</p>
                        <p className="text-sm text-muted-foreground">Fast and secure</p>
                      </div>
                    </label>

                    <label
                      htmlFor="mtn_momo"
                      className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30"
                    >
                      <RadioGroupItem value="mtn_momo" id="mtn_momo" />
                      <Smartphone className="w-5 h-5" />
                      <div>
                        <p className="font-semibold">MTN Mobile Money</p>
                        <p className="text-sm text-muted-foreground">Mobile payment</p>
                      </div>
                    </label>
                  </div>
                </RadioGroup>
              </div>

              {/* Payment details */}
              {paymentMethod === 'stripe' && (
                <div className="space-y-4">
                  <Label>Card details</Label>
                  {!stripePromise ? (
                    <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-4 text-sm text-destructive">
                      Stripe is not configured. Please set a valid <code className="font-mono">VITE_STRIPE_PUBLISHABLE_KEY</code>{' '}
                      (format: <code className="font-mono">pk_test_…</code> or <code className="font-mono">pk_live_…</code>) in your environment variables.
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg px-4 py-3 min-h-[52px] flex items-center">
                      <div className="w-full">
                        <CardElement
                          options={{
                            style: {
                              base: {
                                fontSize: '16px',
                                fontFamily: 'system-ui, -apple-system, sans-serif',
                                color: '#111827',
                                '::placeholder': { color: '#9ca3af' },
                                iconColor: '#6b7280',
                              },
                              invalid: {
                                color: '#ef4444',
                                iconColor: '#ef4444',
                              },
                            },
                            hidePostalCode: true,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Powered by Stripe — your card number never touches our servers.
                  </p>
                </div>
              )}

              {paymentMethod === 'mtn_momo' && (
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input
                    id="phone"
                    placeholder="0880123456"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                  />
                </div>
              )}

              {paymentMethod === 'paypal' && (
                <div className="p-6 bg-secondary/30 rounded-xl text-center">
                  <p className="text-muted-foreground">
                    You'll be redirected to PayPal to complete your payment
                  </p>
                </div>
              )}

              <Separator />

              {/* Special requests */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Add special requests (optional)</h2>
                <Textarea
                  placeholder="Let the host know if you have any special requests..."
                  value={specialRequests}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                  rows={4}
                />
              </div>

              <Separator />

              {/* Ground rules */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Ground rules</h2>
                <p className="text-muted-foreground mb-4">
                  We ask every guest to remember a few simple things about what makes a great guest.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside mb-6">
                  <li>Follow the house rules</li>
                  <li>Treat your Host's home like your own</li>
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

              {momoStatus === 'awaiting' && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                  <p className="font-medium text-foreground">Check your phone to approve the payment</p>
                  <p className="text-muted-foreground mt-1">
                    We sent a MoMo prompt to {phoneNumber}. Approve it on your MTN Mobile Money app to
                    complete the booking. This page will update automatically.
                  </p>
                </div>
              )}

              <Button
                type="button"
                onClick={handlePayment}
                disabled={isProcessing || !agreedToRules || momoStatus === 'awaiting'}
                className="w-full"
                size="lg"
              >
                {momoStatus === 'awaiting'
                  ? 'Waiting for MoMo approval…'
                  : isProcessing
                    ? 'Processing…'
                    : `Confirm and pay ${formatCurrency(displayTotal)}`}
              </Button>
            </div>

            {/* ── Right column: booking summary (sticky) ── */}
            <div className="sticky top-24">
              <div className="border border-border rounded-xl p-4 sm:p-6 space-y-6">

                {/* Property snapshot */}
                <div className="flex gap-4">
                  <img
                    src={currentProperty.images?.[0]}
                    alt={currentProperty.title}
                    className="w-28 h-20 sm:w-32 sm:h-24 rounded-lg object-cover flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground truncate">{currentProperty.propertyType}</p>
                    <h3 className="font-semibold line-clamp-2">{currentProperty.title}</h3>
                    <div className="flex items-center gap-1 text-sm mt-1">
                      <Star className="w-3 h-3 fill-current" />
                      <span className="font-semibold">{currentProperty.rating?.toFixed(2) || '—'}</span>
                      <span className="text-muted-foreground">
                        ({currentProperty.reviewCount || 0} reviews)
                      </span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Selected room (hotels only) */}
                {selectedRoom && (
                  <>
                    <div className="space-y-2">
                      <h2 className="text-lg font-semibold">Selected room</h2>
                      <div className="rounded-lg border border-border p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{selectedRoom.name}</p>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                            {selectedRoom.roomType}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <BedDouble className="w-3 h-3" /> {selectedRoom.beds} {selectedRoom.bedType} bed{selectedRoom.beds > 1 ? 's' : ''}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" /> Up to {selectedRoom.maxOccupancy} guests
                          </span>
                        </div>
                        <p className="text-sm font-semibold">{formatCurrency(selectedRoom.pricePerNight)}<span className="text-xs font-normal text-muted-foreground"> / night</span></p>
                      </div>
                    </div>
                    <Separator />
                  </>
                )}

                {/* Trip dates & guests */}
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">Your booking</h2>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">Dates</p>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(currentCheckIn, 'MMM dd')} – {formatDate(currentCheckOut, 'MMM dd, yyyy')}
                      </p>
                    </div>
                    <Button variant="link" className="p-0 h-auto text-sm" onClick={() => navigate(-1)}>
                      Edit
                    </Button>
                  </div>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium">Guests</p>
                      <p className="text-sm text-muted-foreground">{currentGuests} guest{currentGuests !== 1 ? 's' : ''}</p>
                    </div>
                    <Button variant="link" className="p-0 h-auto text-sm" onClick={() => navigate(-1)}>
                      Edit
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Price breakdown */}
                <div>
                  <h2 className="text-lg font-semibold mb-4">Price details</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span>
                        {formatCurrency(selectedRoom ? selectedRoom.pricePerNight : (currentProperty.price || 0))} ×{' '}
                        {currentPricing.nights || (currentPricing.subtotal && (selectedRoom?.pricePerNight || currentProperty.price)
                          ? Math.round(currentPricing.subtotal / (selectedRoom?.pricePerNight || currentProperty.price))
                          : 0)}{' '}
                        nights{currentRoomQuantity > 1 ? ` × ${currentRoomQuantity} rooms` : ''}
                      </span>
                      <span>{formatCurrency(baseSubtotal)}</span>
                      <span>{formatCurrency(currentPricing.subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Service fee</span>
                      <span>{formatCurrency(baseServiceFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Booking fee</span>
                      <span>{formatCurrency(BOOKING_FEE)}</span>
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="flex justify-between font-semibold text-base">
                    <span>Total (USD)</span>
                    <span>{formatCurrency(displayTotal)}</span>
                  </div>
                </div>

                {/* Secure payment badge */}
                <div className="flex items-start gap-3 p-4 bg-secondary/30 rounded-lg">
                  <Shield className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
                  <div className="text-sm">
                    <p className="font-semibold">Secure payment</p>
                    <p className="text-muted-foreground">Your payment information is encrypted and secure</p>
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

export function Booking() {
  return (
    <Elements stripe={stripePromise}>
      <BookingForm />
    </Elements>
  );
}
