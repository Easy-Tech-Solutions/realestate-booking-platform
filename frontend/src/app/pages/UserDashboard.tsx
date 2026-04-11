import React from 'react';
import { Calendar, Heart, MapPin, Star, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { useApp } from '../../hooks/useApp';
import { formatCurrency, getInitials } from '../../core/utils';
import { useUserDashboardData } from '../../hooks/queries/useUserDashboard';

const statusColor: Record<string, string> = {
  confirmed: 'bg-primary/10 text-primary',
  pending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-600',
};

export function UserDashboard() {
  const { user, isAuthenticated } = useApp();
  const {
    dashboardQuery,
    upcomingTrips,
    pastTrips,
    favoriteProperties,
    userReviews,
    totalSpent,
    isLoading,
  } = useUserDashboardData(user?.id, isAuthenticated);

  if (!user) return null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20">
          <p className="text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <div className="min-h-screen bg-background py-8">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20">
          <h1 className="text-3xl font-semibold mb-2">Welcome back, {user.firstName}!</h1>
          <p className="text-muted-foreground">We couldn't load your dashboard right now. Please try again shortly.</p>
        </div>
      </div>
    );
  }

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
            { label: 'Wishlists', value: favoriteProperties.length, icon: Heart },
            { label: 'Total Spent', value: formatCurrency(totalSpent), icon: Wallet },
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
                {upcomingTrips.length === 0 && (
                  <p className="text-sm text-muted-foreground">No upcoming trips yet.</p>
                )}
                {upcomingTrips.map((trip) => (
                  <div key={trip.booking.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-4">
                      <img src={trip.property.images[0]} alt={trip.property.title} className="w-20 h-16 rounded object-cover" />
                      <div>
                        <h3 className="font-semibold">{trip.property.title}</h3>
                        <p className="text-sm text-muted-foreground">{trip.booking.checkIn} → {trip.booking.checkOut}</p>
                        <p className="text-sm font-semibold mt-1">{formatCurrency(trip.estimatedTotal)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[trip.booking.status]}`}>
                        {trip.booking.status}
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
                {pastTrips.length === 0 && (
                  <p className="text-sm text-muted-foreground">No past trips yet.</p>
                )}
                {pastTrips.map((trip) => (
                  <div key={trip.booking.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-4">
                      <img src={trip.property.images[0]} alt={trip.property.title} className="w-20 h-16 rounded object-cover" />
                      <div>
                        <h3 className="font-semibold">{trip.property.title}</h3>
                        <p className="text-sm text-muted-foreground">{trip.booking.checkIn} → {trip.booking.checkOut}</p>
                        <p className="text-sm font-semibold mt-1">{formatCurrency(trip.estimatedTotal)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[trip.booking.status]}`}>
                        {trip.booking.status}
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
                {favoriteProperties.length === 0 && (
                  <p className="text-sm text-muted-foreground">No saved properties yet.</p>
                )}
                {favoriteProperties.map((property) => (
                  <div key={property.id} className="border border-border rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-shadow">
                    <img src={property.images[0]} alt={property.title} className="w-full h-32 object-cover" />
                    <div className="p-3">
                      <p className="font-semibold">{property.title}</p>
                      <p className="text-sm text-muted-foreground">{property.location.city || 'Location unavailable'}</p>
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
                {userReviews.length === 0 && (
                  <p className="text-sm text-muted-foreground">You haven't written any reviews yet.</p>
                )}
                {userReviews.map(({ review, propertyTitle }) => (
                  <div key={review.id} className="space-y-2 p-4 border border-border rounded-lg">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{propertyTitle}</p>
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
