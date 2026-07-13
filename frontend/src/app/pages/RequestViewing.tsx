import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router';
import { ChevronRight, Smartphone, CalendarDays, Clock, ShieldCheck } from 'lucide-react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { formatCurrency, formatDate } from '../../core/utils';
import { toast } from 'sonner';
import type { PaymentMethod, Property, ViewingAppointment } from '../../core/types';
import { viewingsAPI, paymentAPI, propertiesAPI } from '../../services/api.service';
import { getErrorMessage } from '../../services/api/shared/errors';

const MOMO_POLL_INTERVAL_MS = 3000;
// MoMo is asynchronous — most approvals land within ~2 min. If it takes longer
// we stop blocking the UI and tell the guest it's still processing (the webhook
// reconciles it server-side); we never tell them it "failed".
const MOMO_POLL_TIMEOUT_MS = 2 * 60 * 1000;

const STRIPE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const isValidStripeKey = (key?: string): key is string =>
  !!key && /^pk_(test|live)_[a-zA-Z0-9]{20,}$/.test(key);
const stripePromise = isValidStripeKey(STRIPE_KEY) ? loadStripe(STRIPE_KEY) : null;

// Six 2-hour viewing blocks, 10:00 AM–5:00 PM. Value is the 'HH:MM' start.
const TIME_BLOCKS = [
  { value: '10:00', label: '10:00 AM – 12:00 PM' },
  { value: '11:00', label: '11:00 AM – 1:00 PM' },
  { value: '12:00', label: '12:00 PM – 2:00 PM' },
  { value: '13:00', label: '1:00 PM – 3:00 PM' },
  { value: '14:00', label: '2:00 PM – 4:00 PM' },
  { value: '15:00', label: '3:00 PM – 5:00 PM' },
];

function ViewingForm() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const stripe = useStripe();
  const elements = useElements();

  const listingId = params.id!;
  const [property, setProperty] = useState<Property | null>(location.state?.property ?? null);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('');

  // The created (unpaid) viewing; once set, we move to the payment step.
  const [viewing, setViewing] = useState<ViewingAppointment | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [momoStatus, setMomoStatus] = useState<'idle' | 'awaiting'>('idle');

  useEffect(() => {
    if (!property) {
      propertiesAPI.getById(listingId).then(setProperty).catch(() => {});
    }
    viewingsAPI
      .getSlots(listingId)
      .then((s) => {
        setSlots(s);
        setSelectedDate((prev) => prev || s[0] || '');
      })
      .catch(() => toast.error('Could not load viewing slots.'))
      .finally(() => setLoadingSlots(false));
  }, [listingId, property]);

  const handleRequest = async () => {
    if (!selectedDate) {
      toast.error('Please choose a Saturday');
      return;
    }
    if (!selectedTime) {
      toast.error('Please choose a viewing time');
      return;
    }
    setIsProcessing(true);
    try {
      const v = await viewingsAPI.request({
        listing: listingId,
        viewing_date: selectedDate,
        viewing_time: selectedTime,
      });
      setViewing(v);
      toast.success('Slot held — pay the viewing fee to confirm your request.');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Could not request that slot. Please pick another.');
    } finally {
      setIsProcessing(false);
    }
  };

  const finish = () => {
    toast.success('Viewing fee paid! Our team will schedule and confirm your appointment.');
    navigate('/viewings');
  };

  const handlePay = async () => {
    if (!viewing) return;
    if (paymentMethod === 'mtn_momo' && !phoneNumber) {
      toast.error('Please enter your phone number');
      return;
    }
    if (paymentMethod === 'stripe' && (!stripePromise || !stripe || !elements)) {
      toast.error('Stripe is not ready. Please wait a moment and try again.');
      return;
    }

    setIsProcessing(true);
    try {
      if (paymentMethod === 'stripe') {
        const { client_secret } = await paymentAPI.createViewingFeeIntent(viewing.id);
        const cardElement = elements!.getElement(CardElement);
        if (!cardElement) {
          toast.error('Card element not found. Please refresh and try again.');
          return;
        }
        const result = await stripe!.confirmCardPayment(client_secret, {
          payment_method: { card: cardElement },
        });
        if (result.error) {
          toast.error(result.error.message || 'Card payment failed');
          return;
        }
        finish();
        return;
      }

      const payment = await paymentAPI.initiateViewingMomoPayment(viewing.id, phoneNumber);
      const paymentId = payment?.id || payment?.payment?.id;
      if (!paymentId) {
        toast.error('Could not start MoMo payment. Please try again.');
        return;
      }
      setMomoStatus('awaiting');
      toast.info('Check your phone — approve the MoMo prompt to pay the viewing fee.', { duration: 8000 });

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
      if (confirmed) { finish(); return; }

      // Stopped polling without a definitive result. The payment may still
      // complete via the gateway callback — check the viewing's actual state
      // before deciding what to tell the guest. Never offer a "retry" (the fee
      // is non-refundable; a retry would double-charge).
      try {
        const mine = await viewingsAPI.getMine();
        if (mine.find((x) => x.id === viewing.id)?.isFeePaid) { finish(); return; }
      } catch { /* fall through to processing message */ }

      toast.info(
        "Your payment is still processing — we'll confirm it shortly. Track it under My Viewings.",
        { duration: 8000 }
      );
      navigate('/viewings');
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
        <div className="max-w-3xl mx-auto">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm hover:text-primary mb-6"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back to property
          </button>

          <h1 className="text-3xl font-semibold mb-2">Request a property viewing</h1>
          <p className="text-muted-foreground mb-8 text-sm">
            {property?.title ? `${property.title} · ` : ''}Viewings happen on Saturdays. A Home Konet
            representative will meet you at the property. The viewing fee is non-refundable.
          </p>

          {!viewing ? (
            /* ── Step 1: pick a Saturday ── */
            <div className="border border-border rounded-xl p-6 space-y-5">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Choose a Saturday</h2>
              </div>

              {loadingSlots ? (
                <p className="text-sm text-muted-foreground">Loading available dates…</p>
              ) : slots.length === 0 ? (
                <p className="text-sm text-muted-foreground">No viewing slots are currently available. Please check back later.</p>
              ) : (
                <RadioGroup value={selectedDate} onValueChange={setSelectedDate}>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {slots.map((date) => (
                      <label
                        key={date}
                        htmlFor={`slot-${date}`}
                        className="flex items-center gap-3 p-3 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30"
                      >
                        <RadioGroupItem value={date} id={`slot-${date}`} />
                        <span className="text-sm font-medium">{formatDate(date, 'EEEE, MMM dd, yyyy')}</span>
                      </label>
                    ))}
                  </div>
                </RadioGroup>
              )}

              {slots.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-semibold">Choose a time</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">Each viewing is a 2-hour visit between 10:00 AM and 5:00 PM.</p>
                  <RadioGroup value={selectedTime} onValueChange={setSelectedTime}>
                    <div className="grid sm:grid-cols-2 gap-3">
                      {TIME_BLOCKS.map((block) => (
                        <label
                          key={block.value}
                          htmlFor={`time-${block.value}`}
                          className="flex items-center gap-3 p-3 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30"
                        >
                          <RadioGroupItem value={block.value} id={`time-${block.value}`} />
                          <span className="text-sm font-medium">{block.label}</span>
                        </label>
                      ))}
                    </div>
                  </RadioGroup>
                </div>
              )}

              <Button onClick={handleRequest} disabled={isProcessing || !selectedDate || !selectedTime} className="w-full" size="lg">
                {isProcessing ? 'Holding slot…' : 'Continue to payment'}
              </Button>
            </div>
          ) : (
            /* ── Step 2: pay the viewing fee ── */
            <div className="border border-border rounded-xl p-6 space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-1">Pay the viewing fee</h2>
                <p className="text-sm text-muted-foreground">
                  {formatDate(viewing.viewingDate, 'EEEE, MMM dd, yyyy')}
                  {viewing.viewingTimeRange ? ` · ${viewing.viewingTimeRange}` : ''} · {formatCurrency(viewing.viewingFee)} (non-refundable)
                </p>
              </div>

              <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}>
                <div className="space-y-3">
                  <label htmlFor="stripe" className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30">
                    <RadioGroupItem value="stripe" id="stripe" />
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#635BFF"/><path d="M11.2 9.5c0-.8.7-1.1 1.8-1.1 1.6 0 3.6.5 5 1.3V6.2C16.7 5.4 14.8 5 12.9 5 9.5 5 7 6.8 7 10c0 4.9 6.7 4.1 6.7 6.2 0 1-.8 1.3-1.9 1.3-1.7 0-3.8-.7-5.5-1.6v3.6C7.7 20.4 9.8 21 12 21c3.5 0 6.1-1.7 6.1-5-.1-5.3-6.9-4.3-6.9-6.5z" fill="white"/></svg>
                    <div><p className="font-semibold">Credit or Debit Card</p><p className="text-sm text-muted-foreground">Visa, Mastercard, Amex</p></div>
                  </label>
                  <label htmlFor="mtn_momo" className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30">
                    <RadioGroupItem value="mtn_momo" id="mtn_momo" />
                    <Smartphone className="w-5 h-5" />
                    <div><p className="font-semibold">MTN Mobile Money</p><p className="text-sm text-muted-foreground">Mobile payment · 2% transaction fee applies</p></div>
                  </label>
                </div>
              </RadioGroup>

              {paymentMethod === 'stripe' && (
                <div className="space-y-2">
                  <Label>Card details</Label>
                  {!stripePromise ? (
                    <div className="border border-destructive/40 bg-destructive/5 rounded-lg p-4 text-sm text-destructive">
                      Stripe is not configured.
                    </div>
                  ) : (
                    <div className="border border-border rounded-lg px-4 py-3 min-h-[52px] flex items-center">
                      <div className="w-full">
                        <CardElement options={{ style: { base: { fontSize: '16px', color: '#111827', '::placeholder': { color: '#9ca3af' } }, invalid: { color: '#ef4444' } }, hidePostalCode: true }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {paymentMethod === 'mtn_momo' && (
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input id="phone" placeholder="0880123456" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} />
                  <p className="text-xs text-muted-foreground">MTN Mobile Money charges a 2% transaction fee on top of the amount above.</p>
                </div>
              )}

              {momoStatus === 'awaiting' && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                  <p className="font-medium text-foreground">Check your phone to approve the payment</p>
                  <p className="text-muted-foreground mt-1">We sent a MoMo prompt to {phoneNumber}.</p>
                </div>
              )}

              <Separator />

              <div className="flex items-start gap-3 p-4 bg-secondary/30 rounded-lg">
                <ShieldCheck className="w-5 h-5 flex-shrink-0 mt-0.5 text-primary" />
                <p className="text-sm text-muted-foreground">
                  After the visit, if you're satisfied, you can reserve the property from your trips.
                </p>
              </div>

              <Button onClick={handlePay} disabled={isProcessing || momoStatus === 'awaiting'} className="w-full" size="lg">
                {momoStatus === 'awaiting' ? 'Waiting for MoMo approval…' : isProcessing ? 'Processing…' : `Pay ${formatCurrency(viewing.viewingFee)} viewing fee`}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function RequestViewing() {
  return (
    <Elements stripe={stripePromise}>
      <ViewingForm />
    </Elements>
  );
}
