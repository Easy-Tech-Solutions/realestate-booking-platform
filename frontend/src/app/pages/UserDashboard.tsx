import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Calendar, Heart, MapPin, Star, Wallet, Trash2, Search as SearchIcon, Scale, Bell } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { useApp } from '../../hooks/useApp';
import { formatCurrency, getInitials } from '../../core/utils';
import { useUserDashboardData } from '../../hooks/queries/useUserDashboard';
import { bookingToolsAPI, SavedSearch, SearchAlert, PropertyComparison } from '../../services/api/booking-tools';

const statusColor: Record<string, string> = {
  confirmed: 'bg-primary/10 text-primary',
  pending: 'bg-yellow-100 text-yellow-700',
  declined: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-gray-100 text-gray-600',
  completed: 'bg-gray-100 text-gray-600',
};

export function UserDashboard() {
  const navigate = useNavigate();
  const { user, isAuthenticated, setSearchFilters } = useApp();
  const {
    dashboardQuery,
    upcomingTrips,
    pastTrips,
    favoriteProperties,
    userReviews,
    totalSpent,
    isLoading,
  } = useUserDashboardData(user?.id, isAuthenticated);

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [searchAlerts, setSearchAlerts] = useState<SearchAlert[]>([]);
  const [savedSearchesLoading, setSavedSearchesLoading] = useState(true);
  const [comparisons, setComparisons] = useState<PropertyComparison[]>([]);
  const [comparisonsLoading, setComparisonsLoading] = useState(true);
  const [expandedComparison, setExpandedComparison] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([bookingToolsAPI.getSavedSearches(), bookingToolsAPI.getSearchAlerts()])
      .then(([searches, alerts]) => { setSavedSearches(searches); setSearchAlerts(alerts); })
      .catch(() => toast.error('Failed to load saved searches'))
      .finally(() => setSavedSearchesLoading(false));
    bookingToolsAPI.getComparisons()
      .then(setComparisons)
      .catch(() => toast.error('Failed to load comparisons'))
      .finally(() => setComparisonsLoading(false));
  }, [isAuthenticated]);

  const handleDeleteSavedSearch = async (id: number) => {
    try {
      await bookingToolsAPI.deleteSavedSearch(String(id));
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      toast.success('Saved search removed.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove saved search');
    }
  };

  const handleDeleteComparison = async (id: number) => {
    try {
      await bookingToolsAPI.deleteComparison(String(id));
      setComparisons((prev) => prev.filter((c) => c.id !== id));
      toast.success('Comparison removed.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove comparison');
    }
  };

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
            { label: 'Upcoming Bookings', value: upcomingTrips.length, icon: Calendar },
            { label: 'Past Bookings', value: pastTrips.length, icon: MapPin },
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
          <TabsList className="mb-6 flex overflow-x-auto w-full sm:w-auto">
            <TabsTrigger value="upcoming" className="flex-shrink-0">Upcoming Bookings</TabsTrigger>
            <TabsTrigger value="past" className="flex-shrink-0">Past Bookings</TabsTrigger>
            <TabsTrigger value="wishlists" className="flex-shrink-0">Wishlists</TabsTrigger>
            <TabsTrigger value="reviews" className="flex-shrink-0">My Reviews</TabsTrigger>
            <TabsTrigger value="saved-searches" className="flex-shrink-0">Saved Searches</TabsTrigger>
            <TabsTrigger value="comparisons" className="flex-shrink-0">Comparisons</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming">
            <Card>
              <CardHeader><CardTitle>Upcoming Bookings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {upcomingTrips.length === 0 && (
                  <p className="text-sm text-muted-foreground">No upcoming bookings yet.</p>
                )}
                {upcomingTrips.map((trip) => (
                  <div key={trip.booking.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-4">
                      <img src={trip.property.images[0]} alt={trip.property.title} className="w-20 h-16 rounded object-cover flex-shrink-0" />
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{trip.property.title}</h3>
                        <p className="text-sm text-muted-foreground">{trip.booking.checkIn} → {trip.booking.checkOut}</p>
                        <p className="text-sm font-semibold mt-1">{formatCurrency(trip.estimatedTotal)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[trip.booking.status]}`}>
                        {trip.booking.status}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => navigate(`/rooms/${trip.property.id}`)}>View</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="past">
            <Card>
              <CardHeader><CardTitle>Past Bookings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {pastTrips.length === 0 && (
                  <p className="text-sm text-muted-foreground">No past bookings yet.</p>
                )}
                {pastTrips.map((trip) => (
                  <div key={trip.booking.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-border rounded-lg">
                    <div className="flex items-center gap-4">
                      <img src={trip.property.images[0]} alt={trip.property.title} className="w-20 h-16 rounded object-cover flex-shrink-0" />
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{trip.property.title}</h3>
                        <p className="text-sm text-muted-foreground">{trip.booking.checkIn} → {trip.booking.checkOut}</p>
                        <p className="text-sm font-semibold mt-1">{formatCurrency(trip.estimatedTotal)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusColor[trip.booking.status]}`}>
                        {trip.booking.status}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/rooms/${trip.property.id}?review=open`)}
                      >
                        Review
                      </Button>
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

          <TabsContent value="saved-searches" className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Saved Searches</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {savedSearchesLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : savedSearches.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No saved searches yet — save one from the Filters bar on the Search page.
                  </p>
                ) : (
                  savedSearches.map((s) => (
                    <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border border-border rounded-lg">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">{s.name}</p>
                          <Badge variant="outline" className="text-xs">{s.email_frequency_display}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {[
                            s.address && `Near ${s.address}`,
                            (s.min_price || s.max_price) && `$${s.min_price ?? '0'}–${s.max_price ?? '∞'}`,
                            s.property_type,
                            s.min_bedrooms && `${s.min_bedrooms}+ bedrooms`,
                          ].filter(Boolean).join(' · ') || 'No filters set'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearchFilters({
                              location: s.address || undefined,
                              priceMin: s.min_price ? Number(s.min_price) : undefined,
                              priceMax: s.max_price ? Number(s.max_price) : undefined,
                              bedrooms: s.min_bedrooms ?? undefined,
                              propertyType: s.property_type ? [s.property_type as any] : undefined,
                            });
                            navigate('/search');
                          }}
                        >
                          <SearchIcon className="w-3.5 h-3.5 mr-1" /> Run search
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteSavedSearch(s.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="w-4 h-4" /> Recent Alerts</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {searchAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No new matches yet — we'll notify you here when a listing matches one of your saved searches.
                  </p>
                ) : (
                  searchAlerts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 p-3 border border-border rounded-lg cursor-pointer hover:shadow-sm"
                      onClick={() => navigate(`/rooms/${a.listing}`)}
                    >
                      <div>
                        <p className="font-medium text-sm">{a.listing_title}</p>
                        <p className="text-xs text-muted-foreground">
                          Matched "{a.saved_search_name}" · {a.listing_address}
                        </p>
                      </div>
                      <p className="text-sm font-semibold flex-shrink-0">{formatCurrency(Number(a.listing_price))}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="comparisons">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Scale className="w-4 h-4" /> Property Comparisons</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {comparisonsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                ) : comparisons.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No comparisons yet — select "Compare" on the Search page to compare 2-4 properties side by side.
                  </p>
                ) : (
                  comparisons.map((c) => (
                    <div key={c.id} className="border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between gap-3 p-4">
                        <div>
                          <p className="font-semibold">{c.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {c.total_properties} properties
                            {c.average_price && ` · avg ${formatCurrency(Number(c.average_price))}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setExpandedComparison(expandedComparison === c.id ? null : c.id)}
                          >
                            {expandedComparison === c.id ? 'Hide details' : 'View details'}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteComparison(c.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      {expandedComparison === c.id && (
                        <div className="border-t border-border p-4 space-y-3 bg-muted/30">
                          {c.items.map((item) => (
                            <div key={item.id} className="flex flex-col sm:flex-row sm:items-start gap-3 p-3 border border-border rounded-lg bg-card">
                              <div
                                className="flex-1 cursor-pointer"
                                onClick={() => navigate(`/rooms/${item.listing?.id}`)}
                              >
                                <p className="font-medium">{item.listing_title}</p>
                                <p className="text-sm text-muted-foreground">
                                  {item.listing?.price != null && formatCurrency(Number(item.listing.price))}
                                  {item.listing?.bedrooms != null && ` · ${item.listing.bedrooms} bd`}
                                  {item.listing?.bathrooms != null && ` · ${item.listing.bathrooms} ba`}
                                </p>
                                {item.advantages?.length > 0 && (
                                  <p className="text-xs text-primary mt-1">+ {item.advantages.join(', ')}</p>
                                )}
                                {item.disadvantages?.length > 0 && (
                                  <p className="text-xs text-destructive mt-0.5">− {item.disadvantages.join(', ')}</p>
                                )}
                              </div>
                              <Badge variant="outline" className="flex-shrink-0">Score {item.score}</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
