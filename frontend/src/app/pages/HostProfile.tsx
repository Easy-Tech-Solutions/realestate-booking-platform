import React from 'react';
import { useParams, useNavigate } from 'react-router';
import { Award, MessageSquare, Shield, Star } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { mockUsers, mockProperties, mockReviews } from '../../services/mock-data';
import { PropertyCard } from '../components/PropertyCard';
import { formatDate, getInitials } from '../../core/utils';

export function HostProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const host = mockUsers.find(u => u.id === id);
  const properties = mockProperties.filter(p => p.hostId === id);
  const reviews = mockReviews.filter(r => properties.some(p => p.id === r.propertyId));
  const avgRating = reviews.length
    ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(2)
    : '—';

  if (!host) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Host not found</h2>
          <Button onClick={() => navigate('/')}>Go Home</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <div className="grid lg:grid-cols-3 gap-12">
          {/* Left: Host Card */}
          <div className="lg:col-span-1">
            <div className="border border-border rounded-2xl p-8 text-center sticky top-24">
              {host.avatar ? (
                <img src={host.avatar} alt={host.firstName} className="w-24 h-24 rounded-full object-cover mx-auto mb-4" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-primary text-white flex items-center justify-center text-3xl font-semibold mx-auto mb-4">
                  {getInitials(host.firstName, host.lastName)}
                </div>
              )}
              <h1 className="text-2xl font-semibold">{host.firstName}</h1>
              {host.isHost && (
                <div className="flex items-center justify-center gap-1 mt-1 text-sm text-muted-foreground">
                  <Award className="w-4 h-4 text-primary" />
                  <span>Superhost</span>
                </div>
              )}

              <Separator className="my-6" />

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{reviews.length}</p>
                  <p className="text-xs text-muted-foreground">Reviews</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{avgRating}</p>
                  <p className="text-xs text-muted-foreground">Rating</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{properties.length}</p>
                  <p className="text-xs text-muted-foreground">Listings</p>
                </div>
              </div>

              <Separator className="my-6" />

              <div className="space-y-3 text-sm text-left">
                {host.verified && (
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    <span>Identity verified</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-primary" />
                  <span>Member since {formatDate(host.createdAt, 'MMMM yyyy')}</span>
                </div>
              </div>

              <Button className="w-full mt-6" onClick={() => navigate('/messages')}>
                <MessageSquare className="w-4 h-4 mr-2" /> Contact {host.firstName}
              </Button>
            </div>
          </div>

          {/* Right: Listings + Reviews */}
          <div className="lg:col-span-2 space-y-10">
            {host.bio && (
              <div>
                <h2 className="text-xl font-semibold mb-3">About {host.firstName}</h2>
                <p className="text-muted-foreground leading-relaxed">{host.bio}</p>
              </div>
            )}

            <div>
              <h2 className="text-xl font-semibold mb-6">{host.firstName}'s listings</h2>
              {properties.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-6">
                  {properties.map(p => <PropertyCard key={p.id} property={p} />)}
                </div>
              ) : (
                <p className="text-muted-foreground">No listings yet.</p>
              )}
            </div>

            {reviews.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-6">
                  <Star className="inline w-5 h-5 mr-1 fill-current" />
                  {avgRating} · {reviews.length} review{reviews.length !== 1 ? 's' : ''}
                </h2>
                <div className="space-y-6">
                  {reviews.map(review => (
                    <div key={review.id} className="space-y-2">
                      <div className="flex items-center gap-3">
                        {review.user.avatar ? (
                          <img src={review.user.avatar} alt={review.user.firstName} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                            {getInitials(review.user.firstName, review.user.lastName)}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold">{review.user.firstName} {review.user.lastName}</p>
                          <p className="text-sm text-muted-foreground">{formatDate(review.createdAt, 'MMMM yyyy')}</p>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{review.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
