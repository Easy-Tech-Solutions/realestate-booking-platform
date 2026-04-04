import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import {
  Star, Share, Heart, MapPin, Users, Bed, Bath, Award, Shield,
  ChevronLeft, ChevronRight, X, Minus, Plus,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Separator } from '../components/ui/separator';
import { Calendar } from '../components/ui/calendar';
import { motion, AnimatePresence } from 'motion/react';
import { propertiesAPI, reviewsAPI } from '../../services/api.service';
import { AMENITIES } from '../../core/constants';
import { formatCurrency, calculateNights, calculateTotalPrice, formatDate, getInitials } from '../../core/utils';
import { useApp } from '../../core/context';
import { toast } from 'sonner';
import { DateRange } from 'react-day-picker';
import * as Icons from 'lucide-react';
import type { Property, Review } from '../../core/types';

export function PropertyDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, wishlistIds, toggleWishlist } = useApp();

  const [property, setProperty] = useState<Property | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [guests, setGuests] = useState(2);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (!id) return;
    setIsLoading(true);
    setFetchError(false);
    propertiesAPI.getById(id)
      .then(setProperty)
      .catch(() => setFetchError(true))
      .finally(() => setIsLoading(false));
    reviewsAPI.getByProperty(id)
      .then(setReviews)
      .catch(() => {});
  }, [id]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading property...</p>
      </div>
    );
  }

  if (fetchError || !property) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold mb-2">Property not found</h2>
          <Button onClick={() => navigate('/')}>Back to Home</Button>
        </div>
      </div>
    );
  }

  const isWishlisted = wishlistIds.includes(property.id);
  const nights = dateRange?.from && dateRange?.to ? calculateNights(dateRange.from, dateRange.to) : 0;
  const pricing = nights > 0 ? calculateTotalPrice(property.price, nights, 50) : null;

  const bookedDateSet = new Set(property.bookedDates ?? []);
  const isDateBlocked = (date: Date) => {
    if (date < new Date()) return true;
    const iso = date.toISOString().split('T')[0];
    return bookedDateSet.has(iso);
  };

  const handleReserve = () => {
    if (!isAuthenticated) {
      toast.error('Please log in to make a reservation');
      return;
    }
    if (!dateRange?.from || !dateRange?.to) {
      toast.error('Please select check-in and check-out dates');
      return;
    }
    navigate('/book', {
      state: { property, checkIn: dateRange.from, checkOut: dateRange.to, guests, pricing },
    });
  };

  return (
    <>
      <div className="min-h-screen bg-background pb-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-semibold mb-2">{property.title}</h1>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 fill-current" />
                  <span className="font-semibold">{property.rating.toFixed(2)}</span>
                  <span className="text-muted-foreground">·</span>
                  <button className="underline font-semibold">{property.reviewCount} reviews</button>
                </div>
                <span className="text-muted-foreground">·</span>
                <button className="underline font-semibold">
                  {property.location.city}, {property.location.state}, {property.location.country}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm">
                  <Share className="w-4 h-4 mr-2" />
                  Share
                </Button>
                <Button variant="ghost" size="sm" onClick={() => toggleWishlist(property.id)}>
                  <Heart className={`w-4 h-4 mr-2 ${isWishlisted ? 'fill-destructive text-destructive' : ''}`} />
                  Save
                </Button>
              </div>
            </div>
          </div>

          {/* Image Gallery */}
          <div className="relative grid grid-cols-4 grid-rows-2 gap-2 h-[400px] rounded-xl overflow-hidden mb-8 cursor-pointer">
            <div
              className="col-span-2 row-span-2 relative group"
              onClick={() => { setSelectedImageIndex(0); setShowImageGallery(true); }}
            >
              <img
                src={property.images[0]}
                alt={property.title}
                className="w-full h-full object-cover group-hover:brightness-90 transition-all"
              />
            </div>
            {property.images.slice(1, 5).map((image, index) => (
              <div
                key={index}
                className="relative group"
                onClick={() => { setSelectedImageIndex(index + 1); setShowImageGallery(true); }}
              >
                <img
                  src={image}
                  alt={`${property.title} ${index + 2}`}
                  className="w-full h-full object-cover group-hover:brightness-90 transition-all"
                />
                {index === 3 && property.images.length > 5 && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-white font-semibold">+{property.images.length - 5} photos</span>
                  </div>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="absolute bottom-4 right-4 bg-white z-10"
              onClick={() => setShowImageGallery(true)}
            >
              Show all photos
            </Button>
          </div>

          <div className="grid lg:grid-cols-3 gap-12">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-8">
              {/* Host Info */}
              <div>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-2xl font-semibold mb-2">
                      Entire {property.propertyType} hosted by {property.host.firstName}
                    </h2>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{property.guests} guests</span>
                      <span>·</span>
                      <span>{property.bedrooms} bedrooms</span>
                      <span>·</span>
                      <span>{property.beds} beds</span>
                      <span>·</span>
                      <span>{property.bathrooms} baths</span>
                    </div>
                  </div>
                  {property.host.avatar ? (
                    <img
                      src={property.host.avatar}
                      alt={property.host.firstName}
                      className="w-14 h-14 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-primary text-white flex items-center justify-center text-lg font-semibold">
                      {getInitials(property.host.firstName, property.host.lastName)}
                    </div>
                  )}
                </div>

                <Separator className="my-6" />

                <div className="space-y-6">
                  {property.isSuperhost && (
                    <div className="flex gap-4">
                      <Award className="w-6 h-6 flex-shrink-0" />
                      <div>
                        <h3 className="font-semibold">{property.host.firstName} is a Superhost</h3>
                        <p className="text-muted-foreground text-sm">Superhosts are experienced, highly rated hosts</p>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-4">
                    <MapPin className="w-6 h-6 flex-shrink-0" />
                    <div>
                      <h3 className="font-semibold">Great location</h3>
                      <p className="text-muted-foreground text-sm">95% of recent guests gave the location a 5-star rating</p>
                    </div>
                  </div>
                  {property.instantBook && (
                    <div className="flex gap-4">
                      <Shield className="w-6 h-6 flex-shrink-0" />
                      <div>
                        <h3 className="font-semibold">Self check-in</h3>
                        <p className="text-muted-foreground text-sm">Check yourself in with the smartlock</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* Description */}
              <div>
                <p className="text-foreground leading-relaxed">{property.description}</p>
              </div>

              <Separator />

              {/* Amenities */}
              {property.amenities.length > 0 && (
                <>
                  <div>
                    <h2 className="text-2xl font-semibold mb-6">What this place offers</h2>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {property.amenities.map((amenity) => {
                        const IconComponent = Icons[amenity.icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>;
                        return (
                          <div key={amenity.id} className="flex items-center gap-4">
                            {IconComponent && <IconComponent className="w-6 h-6" />}
                            <span>{amenity.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Separator />
                </>
              )}

              {/* Calendar */}
              <div>
                <h2 className="text-2xl font-semibold mb-6">Select dates</h2>
                <div className="flex justify-center">
                  <Calendar
                    mode="range"
                    selected={dateRange}
                    onSelect={setDateRange}
                    numberOfMonths={2}
                    disabled={isDateBlocked}
                    className="border rounded-xl p-4"
                  />
                </div>
              </div>

              <Separator />

              {/* Reviews */}
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <Star className="w-6 h-6 fill-current" />
                  <h2 className="text-2xl font-semibold">
                    {property.rating.toFixed(2)} · {property.reviewCount} reviews
                  </h2>
                </div>

                <div className="grid sm:grid-cols-2 gap-8">
                  {reviews.map((review) => (
                    <div key={review.id} className="space-y-3">
                      <div className="flex items-center gap-3">
                        {review.user.avatar ? (
                          <img src={review.user.avatar} alt={review.user.firstName} className="w-10 h-10 rounded-full object-cover" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center text-sm font-semibold">
                            {getInitials(review.user.firstName, review.user.lastName)}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold">{review.user.firstName} {review.user.lastName}</p>
                          <p className="text-sm text-muted-foreground">{formatDate(review.createdAt, 'MMMM yyyy')}</p>
                        </div>
                      </div>
                      <p className="text-sm leading-relaxed">{review.comment}</p>
                    </div>
                  ))}
                </div>

                {reviews.length === 0 && (
                  <p className="text-muted-foreground text-sm">No reviews yet.</p>
                )}
              </div>

              <Separator />

              {/* Location */}
              {property.location.lat !== 0 && property.location.lng !== 0 && (
                <div>
                  <h2 className="text-2xl font-semibold mb-6">Where you'll be</h2>
                  <p className="text-muted-foreground mb-4">
                    {property.location.city}, {property.location.state}, {property.location.country}
                  </p>
                  <div className="h-[400px] rounded-xl overflow-hidden">
                    <MapContainer
                      center={L.latLng(property.location.lat, property.location.lng)}
                      zoom={13}
                      style={{ height: '100%', width: '100%' }}
                      scrollWheelZoom={false}
                    >
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      />
                      <Marker position={L.latLng(property.location.lat, property.location.lng)}>
                        <Popup>{property.title}</Popup>
                      </Marker>
                    </MapContainer>
                  </div>
                </div>
              )}

              <Separator />

              {/* House Rules */}
              <div>
                <h2 className="text-2xl font-semibold mb-6">Things to know</h2>
                <div className="grid sm:grid-cols-3 gap-8">
                  <div>
                    <h3 className="font-semibold mb-3">House rules</h3>
                    <div className="space-y-2 text-sm">
                      <p>Check-in: After {property.checkIn}</p>
                      <p>Checkout: Before {property.checkOut}</p>
                      {property.guests > 0 && <p>{property.guests} guests maximum</p>}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-3">Safety & property</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      {property.houseRules.map((rule, index) => (
                        <p key={index}>{rule}</p>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-3">Cancellation policy</h3>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p className="capitalize">{property.cancellationPolicy}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Booking Widget */}
            <div className="lg:col-span-1">
              <div className="sticky top-24">
                <div className="border border-border rounded-xl p-6 shadow-xl">
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-2xl font-semibold">{formatCurrency(property.price)}</span>
                    <span className="text-muted-foreground">night</span>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="grid grid-cols-2 border border-border rounded-xl overflow-hidden">
                      <div className="p-3 border-r border-border">
                        <label className="text-xs font-semibold block mb-1">CHECK-IN</label>
                        <p className="text-sm">
                          {dateRange?.from ? formatDate(dateRange.from, 'MM/dd/yyyy') : 'Add date'}
                        </p>
                      </div>
                      <div className="p-3">
                        <label className="text-xs font-semibold block mb-1">CHECKOUT</label>
                        <p className="text-sm">
                          {dateRange?.to ? formatDate(dateRange.to, 'MM/dd/yyyy') : 'Add date'}
                        </p>
                      </div>
                    </div>

                    <div className="border border-border rounded-xl p-3">
                      <label className="text-xs font-semibold block mb-1">GUESTS</label>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">{guests} guest{guests > 1 ? 's' : ''}</span>
                        <div className="flex items-center gap-2">
                          <button
                            aria-label="Decrease guests"
                            onClick={() => setGuests(g => Math.max(1, g - 1))}
                            className="w-6 h-6 rounded-full border border-border flex items-center justify-center hover:border-foreground disabled:opacity-40"
                            disabled={guests <= 1}
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <button
                            aria-label="Increase guests"
                            onClick={() => setGuests(g => Math.min(property.guests || 10, g + 1))}
                            className="w-6 h-6 rounded-full border border-border flex items-center justify-center hover:border-foreground disabled:opacity-40"
                            disabled={property.guests > 0 && guests >= property.guests}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <Button onClick={handleReserve} className="w-full mb-4" size="lg">
                    Reserve
                  </Button>

                  <p className="text-center text-sm text-muted-foreground mb-4">
                    You won't be charged yet
                  </p>

                  {pricing && (
                    <>
                      <div className="space-y-3 mb-4">
                        <div className="flex justify-between text-sm">
                          <span className="underline">{formatCurrency(property.price)} x {nights} nights</span>
                          <span>{formatCurrency(pricing.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="underline">Cleaning fee</span>
                          <span>{formatCurrency(pricing.cleaningFee)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="underline">Service fee</span>
                          <span>{formatCurrency(pricing.serviceFee)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="underline">Taxes</span>
                          <span>{formatCurrency(pricing.taxes)}</span>
                        </div>
                      </div>
                      <Separator className="my-4" />
                      <div className="flex justify-between font-semibold">
                        <span>Total</span>
                        <span>{formatCurrency(pricing.total)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 bg-white border-t border-border px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <span className="text-lg font-semibold">{formatCurrency(property.price)}</span>
          <span className="text-muted-foreground text-sm"> / night</span>
          {nights > 0 && pricing && (
            <p className="text-xs text-muted-foreground">{nights} nights · {formatCurrency(pricing.total)} total</p>
          )}
        </div>
        <Button onClick={handleReserve} size="lg">Reserve</Button>
      </div>

      {/* Image Gallery Modal */}
      <AnimatePresence>
        {showImageGallery && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black"
          >
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between p-6">
                <button
                  aria-label="Close gallery"
                  onClick={() => setShowImageGallery(false)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X className="w-6 h-6 text-white" />
                </button>
                <p className="text-white">{selectedImageIndex + 1} / {property.images.length}</p>
              </div>

              <div className="flex-1 flex items-center justify-center relative">
                <button
                  aria-label="Previous image"
                  onClick={() => setSelectedImageIndex(prev => prev === 0 ? property.images.length - 1 : prev - 1)}
                  className="absolute left-6 p-3 rounded-full bg-white hover:bg-white/90 transition-colors"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>

                <img
                  src={property.images[selectedImageIndex]}
                  alt={`${property.title} ${selectedImageIndex + 1}`}
                  className="max-h-[80vh] max-w-[90vw] object-contain"
                />

                <button
                  aria-label="Next image"
                  onClick={() => setSelectedImageIndex(prev => prev === property.images.length - 1 ? 0 : prev + 1)}
                  className="absolute right-6 p-3 rounded-full bg-white hover:bg-white/90 transition-colors"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
