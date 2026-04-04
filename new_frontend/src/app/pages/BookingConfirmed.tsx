import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { CheckCircle, Calendar, MapPin, Users, MessageSquare, Download } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { formatCurrency, formatDate } from '../../core/utils';

export function BookingConfirmed() {
  const location = useLocation();
  const navigate = useNavigate();
  const { booking } = location.state || {};

  if (!booking) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">No booking found</h2>
          <Button onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 max-w-2xl">
        {/* Success header */}
        <div className="text-center mb-10">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-3xl font-semibold mb-2">Booking confirmed!</h1>
          <p className="text-muted-foreground">
            Check your email for a confirmation receipt.
          </p>
          <p className="text-sm font-mono text-muted-foreground mt-2">
            Booking ID: <span className="font-semibold text-foreground">{booking.id}</span>
          </p>
        </div>

        {/* Booking summary card */}
        <div className="border border-border rounded-2xl overflow-hidden mb-6">
          <div className="flex gap-4 p-6">
            <img
              src={booking.property.images[0]}
              alt={booking.property.title}
              className="w-28 h-20 rounded-xl object-cover flex-shrink-0"
            />
            <div>
              <p className="text-sm text-muted-foreground capitalize">{booking.property.propertyType}</p>
              <h2 className="font-semibold leading-snug">{booking.property.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Hosted by {booking.property.host.firstName}
              </p>
            </div>
          </div>

          <Separator />

          <div className="p-6 grid sm:grid-cols-3 gap-6">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Dates</p>
                <p className="text-sm font-semibold mt-0.5">
                  {formatDate(booking.checkIn, 'MMM dd')} – {formatDate(booking.checkOut, 'MMM dd, yyyy')}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Users className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Guests</p>
                <p className="text-sm font-semibold mt-0.5">{booking.guests} guest{booking.guests > 1 ? 's' : ''}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Location</p>
                <p className="text-sm font-semibold mt-0.5">
                  {booking.property.location.city}, {booking.property.location.state}
                </p>
              </div>
            </div>
          </div>

          <Separator />

          <div className="p-6 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(booking.basePrice)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cleaning fee</span>
              <span>{formatCurrency(booking.cleaningFee)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Service fee</span>
              <span>{formatCurrency(booking.serviceFee)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Taxes</span>
              <span>{formatCurrency(booking.taxes)}</span>
            </div>
            <Separator className="my-3" />
            <div className="flex justify-between font-semibold">
              <span>Total charged</span>
              <span>{formatCurrency(booking.totalPrice)}</span>
            </div>
          </div>
        </div>

        {/* Check-in info */}
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 mb-6">
          <h3 className="font-semibold mb-2">Check-in information</h3>
          <p className="text-sm text-muted-foreground">
            Check-in is after <strong>{booking.property.checkIn}</strong>. Check-out is before{' '}
            <strong>{booking.property.checkOut}</strong>.
          </p>
          {booking.property.houseRules?.length > 0 && (
            <ul className="mt-3 space-y-1">
              {booking.property.houseRules.slice(0, 3).map((rule: string, i: number) => (
                <li key={i} className="text-sm text-muted-foreground flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-muted-foreground flex-shrink-0" />
                  {rule}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="flex-1" onClick={() => navigate('/messages')}>
            <MessageSquare className="w-4 h-4 mr-2" />
            Message your host
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => navigate('/trips')}>
            View my trips
          </Button>
          <Button variant="outline" size="icon" title="Download receipt">
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
