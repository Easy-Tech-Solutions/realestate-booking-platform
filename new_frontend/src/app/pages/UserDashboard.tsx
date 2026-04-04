import React from 'react';
import { Calendar, Heart, MapPin, MessageSquare, Star, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useApp } from '../../core/context';
import { formatCurrency, getInitials } from '../../core/utils';
import { mockProperties, mockReviews } from '../../services/mock-data';

const upcomingTrips = [
  { property: mockProperties[0], checkIn: 'May 10, 2026', checkOut: 'May 15, 2026', status: 'confirmed' as const, total: 2475 },
  { property: mockProperties[1], checkIn: 'Jun 3, 2026', checkOut: 'Jun 7, 2026', status: 'pending' as const, total: 925 },
];

const pastTrips = [
  { property: mockProperties[2], checkIn: 'Jan 5, 2026', checkOut: 'Jan 8, 2026', status: 'completed' as const, total: 780 },
  { property: mockProperties[4], checkIn: 'Dec 20, 2025', checkOut: 'Dec 27, 2025', status: 'completed' as const, total: 3010 },
];

const statusColor: Record<string, string> = {
  confirmed: 'bg-primary/10 text-primary',
  pending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-600',
};

export function UserDashboard() {
  const { user } = useApp();

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          {user.avatar ? (
            <img src={user.avatar} alt={user.firstName} className="w-16 h-16 rounded-full object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-primary text-white flex items-center justify-center text-xl font-semibold">
              {getInitials(user.firstName, user.lastName)}
            </div>
          )}
          <div>
            <h1 className="text-3xl font-semibold">Welcome back, {user.firstName}!</h1>
            <p className="text-muted-foreground">Here's what's happening with your account</p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {[
            { label: 'Upcoming Trips', value: upcomingTrips.length, icon: Calendar },
            { label: 'Past Trips', value: pastTrips.length, icon: MapPin },
            { label: 'Wishlists', value: 3, icon: Heart },
            { label: 'Total Spent', value: formatCurrency(7190), icon: Wallet },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="upcoming">
          <TabsList className="mb-6">
            <TabsTrigger value="upcoming">Upcoming Trips</TabsTrigger>
            <TabsTrigger value="past">Past Trips</TabsTrigger>
            <TabsTrigger value="wishlists">Wishlists</TabsTrigger>
            <TabsTrigger value="reviews">My Reviews</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming">
            <Card>
              <CardHeader><CardTitle>Upcoming Trips</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {upcomingTrips.map((trip, i) => (
                  <div key={i} className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-4">
                      <img src={trip.property.images[0]} alt={trip.property.title} className="w-20 h-16 rounded object-cover" />
                      <div>
                        <h3 className="font-semibold">{trip.property.title}</h3>
                        <p className="text-sm text-muted-foreground">{trip.checkIn} → {trip.checkOut}</p>
                        <p className="text-sm font-semibold mt-1">{formatCurrency(trip.total)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[trip.status]}`}>
                        {trip.status}
                      </span>
                      <Button variant="outline" size="sm">View</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="past">
            <Card>
              <CardHeader><CardTitle>Past Trips</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {pastTrips.map((trip, i) => (
                  <div key={i} className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-4">
                      <img src={trip.property.images[0]} alt={trip.property.title} className="w-20 h-16 rounded object-cover" />
                      <div>
                        <h3 className="font-semibold">{trip.property.title}</h3>
                        <p className="text-sm text-muted-foreground">{trip.checkIn} → {trip.checkOut}</p>
                        <p className="text-sm font-semibold mt-1">{formatCurrency(trip.total)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[trip.status]}`}>
                        {trip.status}
                      </span>
                      <Button variant="outline" size="sm">Review</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="wishlists">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Your Wishlists</CardTitle>
                <Button size="sm">New wishlist</Button>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-3 gap-4">
                {[
                  { name: 'Beach Getaways', count: 4, img: mockProperties[0].images[0] },
                  { name: 'Mountain Escapes', count: 2, img: mockProperties[1].images[0] },
                  { name: 'City Breaks', count: 3, img: mockProperties[2].images[0] },
                ].map((wl, i) => (
                  <div key={i} className="border border-border rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
                    <img src={wl.img} alt={wl.name} className="w-full h-32 object-cover" />
                    <div className="p-3">
                      <p className="font-semibold">{wl.name}</p>
                      <p className="text-sm text-muted-foreground">{wl.count} properties</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reviews">
            <Card>
              <CardHeader><CardTitle>Reviews You've Written</CardTitle></CardHeader>
              <CardContent className="space-y-6">
                {mockReviews.slice(0, 2).map((review, i) => (
                  <div key={i} className="space-y-2 p-4 border border-border rounded-lg">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{mockProperties.find(p => p.id === review.propertyId)?.title}</p>
                      <div className="flex items-center gap-1">
                        {[...Array(review.rating)].map((_, j) => (
                          <Star key={j} className="w-3 h-3 fill-primary text-primary" />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{review.comment}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
