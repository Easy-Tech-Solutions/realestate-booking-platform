import React from 'react';
import { Calendar, MapPin, Users } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { formatCurrency, formatDate } from '../../core/utils';
import { useNavigate } from 'react-router';

export function Trips() {
  const navigate = useNavigate();

  // Mock bookings
  const upcomingTrips = [
    {
      id: '1',
      property: {
        id: '1',
        title: 'Luxurious Beachfront Villa',
        image: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=400&h=300&fit=crop',
        location: 'Malibu, California',
      },
      checkIn: '2026-04-15',
      checkOut: '2026-04-20',
      guests: 4,
      total: 2450,
    },
  ];

  const pastTrips = [
    {
      id: '2',
      property: {
        id: '2',
        title: 'Cozy Mountain Cabin',
        image: 'https://images.unsplash.com/photo-1542718610-a1d656d1884c?w=400&h=300&fit=crop',
        location: 'Aspen, Colorado',
      },
      checkIn: '2026-02-10',
      checkOut: '2026-02-15',
      guests: 2,
      total: 925,
    },
  ];

  const TripCard = ({ trip, isPast }: { trip: any; isPast?: boolean }) => (
    <div className="border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow">
      <div className="grid md:grid-cols-3 gap-6 p-6">
        <img
          src={trip.property.image}
          alt={trip.property.title}
          className="w-full h-48 md:h-full object-cover rounded-lg"
        />
        <div className="md:col-span-2 space-y-4">
          <div>
            <h3 className="text-xl font-semibold mb-2">{trip.property.title}</h3>
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                {trip.property.location}
              </div>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                {trip.guests} guests
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4" />
            <span>
              {formatDate(trip.checkIn, 'MMM dd')} - {formatDate(trip.checkOut, 'MMM dd, yyyy')}
            </span>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-border">
            <div>
              <p className="text-sm text-muted-foreground">Total price</p>
              <p className="text-xl font-semibold">{formatCurrency(trip.total)}</p>
            </div>
            <div className="flex gap-2">
              {!isPast && (
                <Button variant="outline">Manage booking</Button>
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

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <h1 className="text-3xl font-semibold mb-8">Trips</h1>

        <Tabs defaultValue="upcoming" className="w-full">
          <TabsList className="mb-8">
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="space-y-6">
            {upcomingTrips.length > 0 ? (
              upcomingTrips.map((trip) => <TripCard key={trip.id} trip={trip} />)
            ) : (
              <div className="text-center py-20">
                <h2 className="text-2xl font-semibold mb-2">No trips booked...yet!</h2>
                <p className="text-muted-foreground mb-6">
                  Time to dust off your bags and start planning your next adventure
                </p>
                <Button onClick={() => navigate('/')}>Start searching</Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="past" className="space-y-6">
            {pastTrips.length > 0 ? (
              pastTrips.map((trip) => <TripCard key={trip.id} trip={trip} isPast />)
            ) : (
              <div className="text-center py-20">
                <h2 className="text-2xl font-semibold mb-2">No past trips</h2>
                <p className="text-muted-foreground">
                  Your past trips will appear here
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
