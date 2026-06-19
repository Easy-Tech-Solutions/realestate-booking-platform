import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { Smartphone, ChevronRight, Shield } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { formatCurrency, formatDate } from '../../core/utils';
import { toast } from 'sonner';
import type { Booking, PaymentMethod } from '../../core/types';
import { bookingsAPI, paymentAPI } from '../../services/api.service';
import { getErrorMessage } from '../../services/api/shared/errors';

const MOMO_POLL_INTERVAL_MS = 3000;
const MOMO_POLL_TIMEOUT_MS = 3 * 60 * 1000;

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const isValidStripeKey = (key?: string): key is string =>
  !!key && /^pk_(test|live)_[a-zA-Z0-9]{20,}$/.test(key);
const stripePromise = isValidStripeKey(STRIPE_KEY) ? loadStripe(STRIPE_KEY) : null;

function PaymentForm() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const stripe = useStripe();
  const elements = useElements();

  const [booking, setBooking] = useState<Booking | null>(location.state?.booking ?? null);
  const [loading, setLoading] = useState(!booking);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [momoStatus, setMomoStatus] = useState<'idle' | 'awaiting'>('idle');

  const bookingId = booking?.id || params.id;

  // Load the booking if we arrived without it in navigation state (e.g. refresh).
  useEffect(() => {
    if (!booking && params.id) {
      bookingsAPI
        .getById(params.id)
        .then(setBooking)
        .catch(() => toast.error('Could not load your reservation.'))
        .finally(() => setLoading(false));
    }
  }, [booking, params.id]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!booking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Reservation not found</h2>
          <Button onClick={() => navigate('/trips')}>Go to my trips</Button>
        </div>
      </div>
    );
  }

  if (booking.status !== 'awaiting_payment') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <h2 className="text-2xl font-semibold mb-2">This reservation isn't awaiting payment</h2>
          <p className="text-muted-foreground mb-4">
            Payment is only available once the host has confirmed your reservation.
          </p>
          <Button onClick={() => navigate('/trips')}>Go to my trips</Button>
        </div>
      </div>
    );
  }

  const total = booking.totalPrice || 0;
  const rent = Math.max(total - (booking.serviceFee || 0), 0);

  const finish = () => {
    toast.success('Payment submitted! We\'ll confirm it shortly and share your host\'s contact details.');
    navigate('/trips');
  };

  const handlePayment = async () => {
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
    try {
      if (paymentMethod === 'stripe') {
        let clientSecret: string;
        try {
          const result = await paymentAPI.createBookingPaymentIntent(bookingId!);
          clientSecret = result.client_secret;
        } catch (piErr) {
          toast.error(getErrorMessage(piErr) || 'Could not initialise payment. Please try again.');
          return;
        }

        const cardElement = elements!.getElement(CardElement);
        if (!cardElement) {
          toast.error('Card element not found. Please refresh and try again.');
          return;
        }

        const result = await stripe!.confirmCardPayment(clientSecret, {
          payment_method: { card: cardElement },
        });
        if (result.error) {
          toast.error(result.error.message || 'Card payment failed');
          return;
        }
        finish();
        return;
      }

      // MTN MoMo
      const payment = await paymentAPI.initiateMomoPayment(bookingId!, phoneNumber);
      const paymentId = payment?.id || payment?.payment?.id;
      if (!paymentId) {
        toast.error('Could not start MoMo payment. Please try again.');
        return;
      }

      setMomoStatus('awaiting');
      toast.info('Check your phone — approve the MoMo prompt to complete payment.', { duration: 8000 });

      const started = Date.now();
      let confirmed = false;
      while (Date.now() - started < MOMO_POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, MOMO_POLL_INTERVAL_MS));
        try {
          const res = await paymentAPI.verifyPayment(paymentId);
          const s = res?.payment?.status || res?.status;
          if (s === 'completed') { confirmed = true; break; }
          if (s === 'failed') { toast.error('Payment was declined or failed.'); return; }
        } catch { /* keep polling */ }
      }
      if (!confirmed) {
        toast.error('Payment timed out. You can retry from your trips.');
        return;
      }
      finish();
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Payment failed. Please try again.');
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
            onClick={() => navigate('/trips')}
            className="flex items-center gap-2 text-sm hover:text-primary mb-6"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to trips
          </button>

          <h1 className="text-3xl font-semibold mb-2">Complete your payment</h1>
          <p className="text-muted-foreground mb-8 text-sm">
            Your host confirmed the reservation. Pay within the window to secure your booking.
          </p>

          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
            <div className="space-y-8">
              <div>
                <h2 className="text-xl font-semibold mb-4">Choose how to pay</h2>
                <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                  <div className="space-y-3">
                    <label htmlFor="stripe" className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30">
                      <RadioGroupItem value="stripe" id="stripe" />
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#635BFF"/><path d="M11.2 9.5c0-.8.7-1.1 1.8-1.1 1.6 0 3.6.5 5 1.3V6.2C16.7 5.4 14.8 5 12.9 5 9.5 5 7 6.8 7 10c0 4.9 6.7 4.1 6.7 6.2 0 1-.8 1.3-1.9 1.3-1.7 0-3.8-.7-5.5-1.6v3.6C7.7 20.4 9.8 21 12 21c3.5 0 6.1-1.7 6.1-5-.1-5.3-6.9-4.3-6.9-6.5z" fill="white"/></svg>
                      <div>
                        <p className="font-semibold">Credit or Debit Card</p>
                        <p className="text-sm text-muted-foreground">Visa, Mastercard, Amex</p>
                      </div>
                    </label>
                    <label htmlFor="mtn_momo" className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30">
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

              {paymentMethod === 'stripe' && (
                <div className="space-y-4">
                  <Label>Card details</Label>
                  {!stripePromise ? (
                    <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-4 text-sm text-destructive">
                      Stripe is not configured. Please set a valid <code className="font-mono">VITE_STRIPE_PUBLISHABLE_KEY</code>.
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg px-4 py-3 min-h-[52px] flex items-center">
                      <div className="w-full">
                        <CardElement options={{ style: { base: { fontSize: '16px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#111827', '::placeholder': { color: '#9ca3af' }, iconColor: '#6b7280' }, invalid: { color: '#ef4444', iconColor: '#ef4444' } }, hidePostalCode: true }} />
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Powered by Stripe — your card number never touches our servers.</p>
                </div>
              )}

              {paymentMethod === 'mtn_momo' && (
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input id="phone" placeholder="0880123456" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
                </div>
              )}

              {momoStatus === 'awaiting' && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                  <p className="font-medium text-foreground">Check your phone to approve the payment</p>
                  <p className="text-muted-foreground mt-1">We sent a MoMo prompt to {phoneNumber}.</p>
                </div>
              )}

              <Button type="button" onClick={handlePayment} disabled={isProcessing || momoStatus === 'awaiting'} className="w-full" size="lg">
                {momoStatus === 'awaiting' ? 'Waiting for MoMo approval…' : isProcessing ? 'Processing…' : `Pay ${formatCurrency(total)}`}
              </Button>
            </div>

            {/* Summary */}
            <div className="sticky top-24">
              <div className="border border-border rounded-xl p-4 sm:p-6 space-y-6">
                <div>
                  <p className="text-sm text-muted-foreground">Reservation</p>
                  <h3 className="font-semibold">{booking.property?.title || 'Property'}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatDate(booking.checkIn, 'MMM dd')} – {formatDate(booking.checkOut, 'MMM dd, yyyy')}
                  </p>
                </div>
                <Separator />
                <div>
                  <h2 className="text-lg font-semibold mb-4">Payment due now</h2>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between"><span>Rent</span><span>{formatCurrency(rent)}</span></div>
                    <div className="flex justify-between"><span>Service fee</span><span>{formatCurrency(booking.serviceFee || 0)}</span></div>
                  </div>
                  <Separator className="my-4" />
                  <div className="flex justify-between font-semibold text-base"><span>Total</span><span>{formatCurrency(total)}</span></div>
                </div>
                <div className="flex items-start gap-3 p-4 bg-secondary/30 rounded-lg">
                  <Shield className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
                  <div className="text-sm">
                    <p className="font-semibold">Secure payment</p>
                    <p className="text-muted-foreground">Held safely until an admin confirms and shares your host's contact.</p>
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

export function CompletePayment() {
  return (
    <Elements stripe={stripePromise}>
      <PaymentForm />
    </Elements>
  );
}
