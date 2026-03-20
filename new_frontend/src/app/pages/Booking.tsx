import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CreditCard, Smartphone, Wallet, ChevronRight, Shield, Star } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group';
import { Textarea } from '../components/ui/textarea';
import { formatCurrency, formatDate } from '../../core/utils';
import { toast } from 'sonner';
import { PaymentMethod } from '../../core/types';

export function Booking() {
  const location = useLocation();
  const navigate = useNavigate();
  const { property, checkIn, checkOut, guests, pricing } = location.state || {};

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('stripe');
  const [cardDetails, setCardDetails] = useState({
    number: '',
    expiry: '',
    cvc: '',
    name: '',
  });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [agreedToRules, setAgreedToRules] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // For development: use mock data if no state is provided
  const mockProperty = {
    id: '1',
    title: 'Luxurious Beachfront Villa with Infinity Pool',
    images: ['https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1200&h=800&fit=crop'],
    host: { firstName: 'John', lastName: 'Doe' },
    houseRules: ['No smoking', 'No parties or events', 'Check-in after 3:00 PM'],
    cancellationPolicy: 'flexible',
  };

  const mockCheckIn = new Date('2024-05-10');
  const mockCheckOut = new Date('2024-05-15');
  const mockGuests = 2;
  const mockPricing = {
    subtotal: 2250,
    cleaningFee: 150,
    serviceFee: 337.5,
    taxes: 225,
    total: 2962.5,
  };

  const currentProperty = property || mockProperty;
  const currentCheckIn = checkIn || mockCheckIn;
  const currentCheckOut = checkOut || mockCheckOut;
  const currentGuests = guests || mockGuests;
  const currentPricing = pricing || mockPricing;

  const handlePayment = async () => {
    if (!agreedToRules) {
      toast.error('Please agree to the house rules and cancellation policy');
      return;
    }

    if (paymentMethod === 'stripe' && (!cardDetails.number || !cardDetails.expiry || !cardDetails.cvc)) {
      toast.error('Please enter valid card details');
      return;
    }

    if (paymentMethod === 'mtn_momo' && !phoneNumber) {
      toast.error('Please enter your phone number');
      return;
    }

    setIsProcessing(true);

    // Simulate payment processing
    setTimeout(() => {
      toast.success('Booking confirmed! Check your email for details.');
      navigate('/trips');
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm mb-6 hover:text-primary"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            Back
          </button>

          <h1 className="text-3xl font-semibold mb-8">Confirm and pay</h1>

          <div className="grid lg:grid-cols-2 gap-12">
            {/* Left Column - Payment Form */}
            <div className="space-y-8">
              {/* Trip Details */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Your trip</h2>
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">Dates</p>
                      <p className="text-muted-foreground">
                        {formatDate(currentCheckIn, 'MMM dd')} - {formatDate(currentCheckOut, 'MMM dd, yyyy')}
                      </p>
                    </div>
                    <Button variant="link" className="p-0 h-auto">
                      Edit
                    </Button>
                  </div>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold">Guests</p>
                      <p className="text-muted-foreground">{currentGuests} guests</p>
                    </div>
                    <Button variant="link" className="p-0 h-auto">
                      Edit
                    </Button>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Payment Method */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Choose how to pay</h2>
                <RadioGroup value={paymentMethod} onValueChange={(value) => setPaymentMethod(value as PaymentMethod)}>
                  <div className="space-y-3">
                    <label
                      htmlFor="stripe"
                      className="flex items-center gap-4 p-4 border-2 border-border rounded-xl cursor-pointer hover:border-primary transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary/30"
                    >
                      <RadioGroupItem value="stripe" id="stripe" />
                      <CreditCard className="w-5 h-5" />
                      <div className="flex-1">
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
                      <div className="flex-1">
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
                      <div className="flex-1">
                        <p className="font-semibold">MTN Mobile Money</p>
                        <p className="text-sm text-muted-foreground">Mobile payment</p>
                      </div>
                    </label>
                  </div>
                </RadioGroup>
              </div>

              {/* Payment Details */}
              {paymentMethod === 'stripe' && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="cardNumber">Card number</Label>
                    <Input
                      id="cardNumber"
                      placeholder="1234 5678 9012 3456"
                      value={cardDetails.number}
                      onChange={(e) => setCardDetails({ ...cardDetails, number: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="expiry">Expiration</Label>
                      <Input
                        id="expiry"
                        placeholder="MM/YY"
                        value={cardDetails.expiry}
                        onChange={(e) => setCardDetails({ ...cardDetails, expiry: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cvc">CVC</Label>
                      <Input
                        id="cvc"
                        placeholder="123"
                        value={cardDetails.cvc}
                        onChange={(e) => setCardDetails({ ...cardDetails, cvc: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cardName">Cardholder name</Label>
                    <Input
                      id="cardName"
                      placeholder="Name on card"
                      value={cardDetails.name}
                      onChange={(e) => setCardDetails({ ...cardDetails, name: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {paymentMethod === 'mtn_momo' && (
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone number</Label>
                  <Input
                    id="phone"
                    placeholder="+1 234 567 8900"
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

              {/* Special Requests */}
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

              {/* Ground Rules */}
              <div>
                <h2 className="text-xl font-semibold mb-4">Ground rules</h2>
                <p className="text-muted-foreground mb-4">
                  We ask every guest to remember a few simple things about what makes a great guest.
                </p>
                <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                  <li>Follow the house rules</li>
                  <li>Treat your Host's home like your own</li>
                </ul>

                <div className="mt-6">
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
              </div>

              {/* Payment Button */}
              <Button
                onClick={handlePayment}
                disabled={isProcessing || !agreedToRules}
                className="w-full"
                size="lg"
              >
                {isProcessing ? 'Processing...' : `Confirm and pay ${formatCurrency(currentPricing.total)}`}
              </Button>
            </div>

            {/* Right Column - Booking Summary */}
            <div>
              <div className="sticky top-24 border border-border rounded-xl p-6">
                <div className="flex gap-4 mb-6">
                  <img
                    src={currentProperty.images[0]}
                    alt={currentProperty.title}
                    className="w-32 h-24 rounded-lg object-cover"
                  />
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{currentProperty.propertyType}</p>
                    <h3 className="font-semibold mb-2 line-clamp-2">{currentProperty.title}</h3>
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-3 h-3 fill-current" />
                      <span className="font-semibold">{currentProperty.rating?.toFixed(2) || '4.9'}</span>
                      <span className="text-muted-foreground">
                        ({currentProperty.reviewCount || 127} reviews)
                      </span>
                    </div>
                  </div>
                </div>

                <Separator className="my-6" />

                <h3 className="font-semibold mb-4">Price details</h3>
                <div className="space-y-3 mb-6">
                  <div className="flex justify-between text-sm">
                    <span>
                      {formatCurrency(currentProperty.price || 450)} x {(currentPricing.subtotal / (currentProperty.price || 450)).toFixed(0)} nights
                    </span>
                    <span>{formatCurrency(currentPricing.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Cleaning fee</span>
                    <span>{formatCurrency(currentPricing.cleaningFee)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Service fee</span>
                    <span>{formatCurrency(currentPricing.serviceFee)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Taxes</span>
                    <span>{formatCurrency(currentPricing.taxes)}</span>
                  </div>
                </div>

                <Separator className="my-6" />

                <div className="flex justify-between font-semibold text-lg mb-6">
                  <span>Total (USD)</span>
                  <span>{formatCurrency(currentPricing.total)}</span>
                </div>

                <div className="flex items-start gap-3 p-4 bg-secondary/30 rounded-lg">
                  <Shield className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold mb-1">Secure payment</p>
                    <p className="text-muted-foreground">
                      Your payment information is encrypted and secure
                    </p>
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
