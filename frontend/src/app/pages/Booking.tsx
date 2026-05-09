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
import { bookingsAPI } from '../../services/api.service';
import { fetchWithAuth } from '../../services/api/shared/client';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

function BookingForm() {
  const location = useLocation();
  const navigate = useNavigate();
  const { property, checkIn, checkOut, guests, pricing, selectedRoom } = location.state || {};

  const stripe = useStripe();
  const elements = useElements();

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [agreedToRules, setAgreedToRules] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const currentProperty = property;
  const currentCheckIn = checkIn;
  const currentCheckOut = checkOut;
  const currentGuests = guests || 1;
  const currentPricing = pricing || { subtotal: 0, cleaningFee: 0, serviceFee: 0, taxes: 0, total: 0 };

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
    if (paymentMethod === 'stripe' && (!stripe || !elements)) {
      toast.error('Stripe has not loaded yet. Please try again.');
      return;
    }

    setIsProcessing(true);
    try {
      const startDate = currentCheckIn instanceof Date
        ? currentCheckIn.toISOString().split('T')[0]
        : currentCheckIn;
      const endDate = currentCheckOut instanceof Date
        ? currentCheckOut.toISOString().split('T')[0]
        : currentCheckOut;

      if (paymentMethod === 'stripe') {
        const amountCents = Math.round(currentPricing.total * 100);
        const { client_secret } = await fetchWithAuth<{ client_secret: string }>(
          '/api/payments/stripe/payment-intent/',
          { method: 'POST', body: JSON.stringify({ amount_cents: amountCents, currency: 'usd' }) }
        );

        const cardElement = elements!.getElement(CardElement);
        if (!cardElement) {
          toast.error('Card element not found');
          return;
        }

        const { error: stripeError } = await stripe!.confirmCardPayment(client_secret, {
          payment_method: { card: cardElement },
        });

        if (stripeError) {
          toast.error(stripeError.message || 'Card payment failed');
          return;
        }
      }

      const booking = await bookingsAPI.create({
        listing: currentProperty.id,
        start_date: startDate,
        end_date: endDate,
        notes: specialRequests,
        ...(selectedRoom ? { hotel_room: selectedRoom.id } : {}),
      });

      const confirmedBooking = {
        ...booking,
        property: currentProperty,
        checkIn: startDate,
        checkOut: endDate,
        guests: currentGuests,
        totalPrice: currentPricing.total,
        basePrice: currentPricing.subtotal,
        cleaningFee: currentPricing.cleaningFee,
        serviceFee: currentPricing.serviceFee,
        taxes: currentPricing.taxes,
        paymentMethod,
      };

      toast.success('Booking confirmed!');
      navigate('/booking/confirmed', {
        state: { booking: confirmedBooking },
      });
    } catch (err: any) {
      toast.error(err.message || 'Booking failed. Please try again.');
    } finally {
      setIsProcessing(false);
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
                  <div className="border border-border rounded-lg p-4">
                    <CardElement
                      options={{
                        style: {
                          base: {
                            fontSize: '16px',
                            color: 'hsl(var(--foreground))',
                            '::placeholder': { color: 'hsl(var(--muted-foreground))' },
                          },
                        },
                      }}
                    />
                  </div>
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

              <Button
                type="button"
                onClick={handlePayment}
                disabled={isProcessing || !agreedToRules}
                className="w-full"
                size="lg"
              >
                {isProcessing ? 'Processing...' : `Confirm and pay ${formatCurrency(currentPricing.total)}`}
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
                  <h2 className="text-lg font-semibold">Your trip</h2>
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
                        nights
                      </span>
                      <span>{formatCurrency(currentPricing.subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cleaning fee</span>
                      <span>{formatCurrency(currentPricing.cleaningFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Service fee</span>
                      <span>{formatCurrency(currentPricing.serviceFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Taxes</span>
                      <span>{formatCurrency(currentPricing.taxes)}</span>
                    </div>
                  </div>

                  <Separator className="my-4" />

                  <div className="flex justify-between font-semibold text-base">
                    <span>Total (USD)</span>
                    <span>{formatCurrency(currentPricing.total)}</span>
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
