import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router';
import {
  Star, Share, Heart, MapPin, Award, Shield,
  ChevronLeft, ChevronRight, X, Minus, Plus, MessageCircle, BedDouble, Users, Check,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Separator } from '../components/ui/separator';
import { Calendar } from '../components/ui/calendar';
import { motion, AnimatePresence } from 'motion/react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { CANCELLATION_POLICIES } from '../../core/constants';
import { formatCurrency, calculateNights, formatDate, getInitials } from '../../core/utils';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';
import { messagesAPI, propertiesAPI } from '../../services/api.service';
import { DateRange } from 'react-day-picker';
import type { Property, Review, HotelRoom, HotelRoomAvailability } from '../../core/types';
import { ReportDialog } from '../components/ReportDialog';
import { getErrorMessage } from '../../services/api/shared/errors';
import { usePropertyDetails } from '../../hooks/queries/usePropertyDetails';
import { usePropertyPricing } from '../../hooks/queries/usePropertyPricing';
import { fallbackIcon, iconMap } from '../../core/icon-map';
import { queryKeys } from '../../hooks/queries/keys';
import { LiberiaMap } from '../components/LiberiaMap';

function addMonths(d: Date, months: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + months);
  return x;
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          className="p-0.5"
          aria-label={`${n} star${n !== 1 ? 's' : ''}`}
        >
          <Star
            className={`w-6 h-6 transition-colors ${
              n <= (hovered || value) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

export function PropertyDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, wishlistIds, toggleWishlist, user } = useApp();
  const queryClient = useQueryClient();
  const [messagingHost, setMessagingHost] = useState(false);

  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [showImageGallery, setShowImageGallery] = useState(false);
  const [mobileSlideIndex, setMobileSlideIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const touchStartX = useRef<number>(0);

  const { propertyQuery, reviewsQuery, availabilityQuery } = usePropertyDetails(id);

  const pauseAndResume = useCallback(() => {
    setIsAutoPlaying(false);
    const t = setTimeout(() => setIsAutoPlaying(true), 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!isAutoPlaying) return;
    const timer = setInterval(() => {
      setMobileSlideIndex(prev => {
        const total = propertyQuery.data?.images?.length ?? 0;
        return total > 0 ? (prev + 1) % total : 0;
      });
    }, 4000);
    return () => clearInterval(timer);
  }, [isAutoPlaying, propertyQuery.data?.images?.length]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  // Long-term (monthly) listings: the guest picks a single move-in date and the
  // end date is derived from the host's fixed lease term.
  const [moveInDate, setMoveInDate] = useState<Date | undefined>();
  const [guests, setGuests] = useState(2);

  const [showReviewForm, setShowReviewForm] = useState(false);

  // Deep-link from the user dashboard's "Review" button:
  // /rooms/<id>?review=open auto-opens the review form on load.
  useEffect(() => {
    if (searchParams.get('review') === 'open') {
      setShowReviewForm(true);
    }
  }, [searchParams]);

  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewForm, setReviewForm] = useState({
    rating: 0, title: '', content: '',
    cleanliness: 0, accuracy: 0, check_in_rating: 0,
    communication: 0, location_rating: 0, value: 0,
  });
  const [selectedRoom, setSelectedRoom] = useState<HotelRoom | null>(null);
  const [roomQuantity, setRoomQuantity] = useState(1);
  // Long-term listings derive the date range from move-in + lease term; nightly
  // listings use the calendar range. Everything downstream (pricing, reserve)
  // reads these effective dates.
  const isMonthly = propertyQuery.data?.pricingType === 'monthly';
  const leaseMonths = propertyQuery.data?.leaseTermMonths || 12;
  const effFrom = isMonthly ? moveInDate : dateRange?.from;
  const effTo = isMonthly
    ? (moveInDate ? addMonths(moveInDate, leaseMonths) : undefined)
    : dateRange?.to;

  const pricingQuery = usePropertyPricing(
    id,
    effFrom?.toISOString().split('T')[0],
    effTo?.toISOString().split('T')[0],
    selectedRoom?.id,
  );

  const startDateStr = effFrom?.toISOString().split('T')[0];
  const endDateStr = effTo?.toISOString().split('T')[0];
  const isHotel = propertyQuery.data?.propertyType === 'hotels';

  const roomAvailabilityQuery = useQuery({
    queryKey: ['hotel-rooms-availability', id, startDateStr, endDateStr],
    queryFn: () => propertiesAPI.getRoomAvailability(id!, startDateStr!, endDateStr!),
    enabled: Boolean(isHotel && id && startDateStr && endDateStr),
  });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  useEffect(() => {
    if (propertyQuery.error || reviewsQuery.error || availabilityQuery.error) {
      toast.error(getErrorMessage(propertyQuery.error || reviewsQuery.error || availabilityQuery.error, 'Failed to load property'));
    }
  }, [propertyQuery.error, reviewsQuery.error, availabilityQuery.error]);

  useEffect(() => {
    if (pricingQuery.error) {
      toast.error(getErrorMessage(pricingQuery.error, 'Failed to calculate pricing'));
    }
  }, [pricingQuery.error]);

  const property = useMemo<Property | null>(() => {
    if (!propertyQuery.data) {
      return null;
    }
    return {
      ...propertyQuery.data,
      bookedDates: availabilityQuery.data || [],
    };
  }, [propertyQuery.data, availabilityQuery.data]);

  const reviews: Review[] = reviewsQuery.data || [];
  const pricing = pricingQuery.data || null;
  const isLoading = propertyQuery.isLoading || reviewsQuery.isLoading || availabilityQuery.isLoading;
  const fetchError = propertyQuery.isError;

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
  const reviewCategoryAverages = reviews.length ? [
    { label: 'Cleanliness', value: reviews.reduce((sum, review) => sum + review.cleanliness, 0) / reviews.length },
    { label: 'Accuracy', value: reviews.reduce((sum, review) => sum + review.accuracy, 0) / reviews.length },
    { label: 'Check-in', value: reviews.reduce((sum, review) => sum + review.checkIn, 0) / reviews.length },
    { label: 'Communication', value: reviews.reduce((sum, review) => sum + review.communication, 0) / reviews.length },
    { label: 'Location', value: reviews.reduce((sum, review) => sum + review.location, 0) / reviews.length },
    { label: 'Value', value: reviews.reduce((sum, review) => sum + review.value, 0) / reviews.length },
  ] : [];
  const cancellationPolicy = CANCELLATION_POLICIES[property.cancellationPolicy];

  const bookedDateSet = new Set(property.bookedDates ?? []);
  const isPastDate = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  };
  const isBookedDate = (date: Date) =>
    bookedDateSet.has(date.toISOString().split('T')[0]);

  const handleDateRangeSelect = (range: typeof dateRange) => {
    // Reject any range that overlaps a confirmed booking. The check uses
    // `cursor < to` because the check-out morning is available for the next
    // guest — only the nights in [from, to) are actually occupied.
    if (range?.from && range?.to) {
      const cursor = new Date(range.from);
      while (cursor < range.to) {
        if (bookedDateSet.has(cursor.toISOString().split('T')[0])) {
          toast.error('Your selection overlaps with dates that are already booked.');
          return;
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    setDateRange(range);
  };

  const handleDayClick = (day: Date, modifiers: Record<string, boolean>) => {
    if (modifiers.booked) {
      toast.info('This date is already booked. Please choose a different date.');
    }
  };

  const isOwner = !!user && !!property && String(user.id) === String(property.hostId);
  // Long-term (monthly) listings are priced per month; everything else per night.
  const priceUnit = property?.pricingType === 'monthly' ? 'month' : 'night';

  const handleReserve = () => {
    if (!isAuthenticated) {
      toast.error('Please log in to make a reservation');
      return;
    }
    if (isOwner) {
      toast.error("You can't book your own listing.");
      return;
    }
    if (!effFrom || !effTo) {
      toast.error(isMonthly ? 'Please select a move-in date' : 'Please select check-in and check-out dates');
      return;
    }
    const hotelRooms = propertyQuery.data?.hotelRooms ?? [];
    if (isHotel && hotelRooms.length > 0 && !selectedRoom) {
      toast.error('Please select a room type to continue');
      return;
    }
    navigate('/book', {
      state: { property, checkIn: effFrom, checkOut: effTo, guests, pricing, selectedRoom, roomQuantity },
    });
  };

  // The checkout card is shared between the desktop sticky sidebar and the
  // mobile layout (where it sits right below the calendar).
  const bookingCard = (
    <div className="border border-border rounded-xl p-4 sm:p-6 shadow-xl">
      <div className="flex items-baseline gap-1 mb-4">
        <span className="text-2xl font-semibold">
          {formatCurrency(selectedRoom ? selectedRoom.pricePerNight : property.price)}
        </span>
        <span className="text-muted-foreground">{selectedRoom ? 'night' : priceUnit}</span>
        {selectedRoom && (
          <span className="text-xs text-muted-foreground ml-1">· {selectedRoom.name}</span>
        )}
      </div>

      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-2 border border-border rounded-xl overflow-hidden">
          <div className="p-3 border-r border-border">
            <label className="text-xs font-semibold block mb-1">{isMonthly ? 'MOVE-IN' : 'CHECK-IN'}</label>
            <p className="text-sm">{effFrom ? formatDate(effFrom, 'MM/dd/yyyy') : 'Add date'}</p>
          </div>
          <div className="p-3">
            <label className="text-xs font-semibold block mb-1">{isMonthly ? 'LEASE ENDS' : 'CHECKOUT'}</label>
            <p className="text-sm">{effTo ? formatDate(effTo, 'MM/dd/yyyy') : 'Add date'}</p>
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

      {isOwner ? (
        <div className="rounded-lg bg-secondary/40 p-4 text-center text-sm text-muted-foreground mb-4">
          This is your listing. Manage it from your{' '}
          <button className="underline font-medium" onClick={() => navigate('/host')}>host dashboard</button>.
        </div>
      ) : (
        <>
          <Button onClick={handleReserve} className="w-full mb-3" size="lg">Reserve</Button>

          {property.pricingType === 'monthly' && (
            <Button
              variant="outline"
              className="w-full mb-4"
              size="lg"
              onClick={() => {
                if (!isAuthenticated) {
                  toast.error('Please log in to request a viewing');
                  return;
                }
                navigate(`/rooms/${property.id}/viewing`, { state: { property } });
              }}
            >
              Request a viewing first
            </Button>
          )}

          <p className="text-center text-sm text-muted-foreground mb-4">You won't be charged yet</p>
        </>
      )}

      {pricing && (
        <>
          <div className="space-y-3 mb-4">
            <div className="flex justify-between text-sm">
              <span className="underline">
                {pricing.pricingType === 'monthly'
                  ? `First ${pricing.monthsUpfront || 1} month${(pricing.monthsUpfront || 1) > 1 ? 's' : ''}`
                  : `${formatCurrency(selectedRoom ? selectedRoom.pricePerNight : property.price)} x ${nights} nights`}
              </span>
              <span>{formatCurrency(pricing.subtotal)}</span>
            </div>
            {pricing.discount > 0 && (
              <div className="flex justify-between text-sm text-green-700">
                <span className="underline">{pricing.discountLabel || 'Discount'}</span>
                <span>-{formatCurrency(pricing.discount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="underline">Service fee</span>
              <span>{formatCurrency(pricing.serviceFee)}</span>
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
  );

  return (
    <>
      <div className="min-h-screen bg-background pb-20">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-semibold mb-2">{property.title}</h1>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-2 text-sm flex-wrap">
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Star className="w-4 h-4 fill-current" />
                  <span className="font-semibold">{property.rating.toFixed(2)}</span>
                  <span className="text-muted-foreground">·</span>
                  <button className="underline font-semibold">{property.reviewCount} reviews</button>
                </div>
                <span className="text-muted-foreground flex-shrink-0">·</span>
                <button className="underline font-semibold text-left">
                  {property.location.city}, {property.location.state}, {property.location.country}
                </button>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={async () => {
                    const url = window.location.href;
                    const title = property.title;
                    if (navigator.share) {
                      try {
                        await navigator.share({ title, url });
                      } catch {
                        // user cancelled — no action needed
                      }
                    } else {
                      await navigator.clipboard.writeText(url);
                      import('sonner').then(({ toast }) => toast.success('Link copied to clipboard'));
                    }
                  }}
                >
                  <Share className="w-4 h-4 mr-2" />
                  Share
                </Button>
                <Button variant="ghost" size="sm" onClick={() => toggleWishlist(property.id)}>
                  <Heart className={`w-4 h-4 mr-2 ${isWishlisted ? 'fill-destructive text-destructive' : ''}`} />
                  Save
                </Button>
                {isAuthenticated && (
                  <ReportDialog
                    triggerLabel="Report listing"
                    triggerVariant="ghost"
                    defaultContentType="listing"
                    reportedListingId={property.id}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Mobile Image Slider */}
          <div className="relative md:hidden mb-8 rounded-xl overflow-hidden">
            <div
              className="relative h-[280px] overflow-hidden rounded-xl select-none"
              onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; setIsAutoPlaying(false); }}
              onTouchEnd={(e) => {
                const delta = touchStartX.current - e.changedTouches[0].clientX;
                if (Math.abs(delta) > 40) {
                  const total = property.images.length;
                  setMobileSlideIndex(prev => delta > 0 ? (prev + 1) % total : (prev - 1 + total) % total);
                }
                pauseAndResume();
              }}
              onClick={() => { setSelectedImageIndex(mobileSlideIndex); setShowImageGallery(true); }}
            >
              {/* Sliding strip — each slide is exactly 1/N of the total strip width */}
              <div
                className="flex h-full transition-transform duration-300 ease-in-out will-change-transform"
                style={{
                  width: `${property.images.length * 100}%`,
                  transform: `translateX(-${(mobileSlideIndex / property.images.length) * 100}%)`,
                }}
              >
                {property.images.map((img, i) => (
                  <div key={i} className="h-full flex-shrink-0" style={{ width: `${100 / property.images.length}%` }}>
                    <img src={img} alt={`${property.title} ${i + 1}`} className="w-full h-full object-cover" draggable={false} />
                  </div>
                ))}
              </div>

              {/* Prev / Next */}
              <button
                aria-label="Previous photo"
                onClick={(e) => { e.stopPropagation(); const t = property.images.length; setMobileSlideIndex(p => (p - 1 + t) % t); pauseAndResume(); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                aria-label="Next photo"
                onClick={(e) => { e.stopPropagation(); setMobileSlideIndex(p => (p + 1) % property.images.length); pauseAndResume(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              {/* Counter badge */}
              <span className="absolute top-3 right-3 bg-black/50 text-white text-xs font-medium px-2 py-0.5 rounded-full">
                {mobileSlideIndex + 1} / {property.images.length}
              </span>

              {/* Dot indicators */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {property.images.map((_, i) => (
                  <button
                    key={i}
                    aria-label={`Go to photo ${i + 1}`}
                    onClick={(e) => { e.stopPropagation(); setMobileSlideIndex(i); pauseAndResume(); }}
                    className={`h-1.5 rounded-full transition-all duration-300 ${i === mobileSlideIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Image Gallery — desktop grid */}
          <div className="relative hidden md:grid grid-cols-4 grid-rows-2 gap-2 h-[400px] rounded-xl overflow-hidden mb-8 cursor-pointer">
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

          <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
            {/* Main Content */}
            <div className="lg:col-span-2 lg:order-1 space-y-8">
              {/* Host Info */}
              <div>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-xl sm:text-2xl font-semibold mb-2">
                      Entire {property.propertyType} hosted by {property.host.firstName} {property.host.lastName}
                    </h2>
                    <div className="flex items-center gap-2 text-muted-foreground flex-wrap text-sm">
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

                {isAuthenticated && user?.id !== property.hostId && (
                  <div className="flex items-center gap-3 mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={messagingHost}
                      onClick={async () => {
                        setMessagingHost(true);
                        try {
                          const conv = await messagesAPI.startConversation(
                            property.hostId,
                            '',
                            property.id,
                          );
                          navigate(`/messages?conversation=${conv.id}`);
                        } catch {
                          toast.error('Could not start conversation. Please try again.');
                        } finally {
                          setMessagingHost(false);
                        }
                      }}
                    >
                      <MessageCircle className="w-4 h-4" />
                      {messagingHost ? 'Opening…' : `Message ${property.host.firstName}`}
                    </Button>
                    <ReportDialog
                      triggerLabel={`Report ${property.host.firstName}`}
                      defaultContentType="user"
                      reportedUserId={property.hostId}
                    />
                  </div>
                )}

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
                  {reviewCategoryAverages.length > 0 && reviewCategoryAverages.find(r => r.label === 'Location')?.value >= 4.5 && (
                    <div className="flex gap-4">
                      <MapPin className="w-6 h-6 flex-shrink-0" />
                      <div>
                        <h3 className="font-semibold">Great location</h3>
                        <p className="text-muted-foreground text-sm">95% of recent guests gave the location a 5-star rating</p>
                      </div>
                    </div>
                  )}
                  {property.selfCheckin && (
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

              {/* Hotel Rooms Section */}
              {isHotel && (property.hotelRooms?.length ?? 0) > 0 && (
                <>
                  <div>
                    <h2 className="text-2xl font-semibold mb-2">Available Rooms</h2>
                    {!startDateStr || !endDateStr ? (
                      <p className="text-sm text-muted-foreground mb-4">Select dates above to see room availability.</p>
                    ) : null}
                    <div className="space-y-4">
                      {(roomAvailabilityQuery.data ?? property.hotelRooms ?? []).map((room: HotelRoom | HotelRoomAvailability) => {
                        const available = 'availableCount' in room ? room.availableCount : room.totalCount;
                        const isUnavailable = startDateStr && endDateStr && available === 0;
                        const isSelected = selectedRoom?.id === room.id;
                        return (
                          <div
                            key={room.id}
                            onClick={() => {
                            if (!isUnavailable) {
                              setSelectedRoom(isSelected ? null : room);
                              setRoomQuantity(1);
                            }
                          }}
                            className={`border rounded-xl overflow-hidden transition-all cursor-pointer ${
                              isUnavailable
                                ? 'opacity-50 cursor-not-allowed border-border'
                                : isSelected
                                ? 'border-primary ring-1 ring-primary bg-primary/5'
                                : 'border-border hover:border-primary/60'
                            }`}
                          >
                            {room.images && room.images.length > 0 && (
                              <div className="flex gap-1 h-40 overflow-hidden">
                                <div className="flex-1 overflow-hidden">
                                  <img
                                    src={room.images[0].imageUrl}
                                    alt={room.images[0].caption || room.name}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                {room.images.length > 1 && (
                                  <div className="flex flex-col gap-1 w-24 shrink-0">
                                    {room.images.slice(1, 3).map((img, i) => (
                                      <div key={img.id} className="flex-1 overflow-hidden relative">
                                        <img
                                          src={img.imageUrl}
                                          alt={img.caption || room.name}
                                          className="w-full h-full object-cover"
                                        />
                                        {i === 1 && room.images.length > 3 && (
                                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <span className="text-white text-sm font-semibold">+{room.images.length - 3}</span>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="p-4">
                              <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                                    <h3 className="font-semibold">{room.name}</h3>
                                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                                      {room.roomType}
                                    </span>
                                    {isSelected && <Check className="w-4 h-4 text-primary" />}
                                  </div>
                                  <div className="flex items-center gap-3 text-sm text-muted-foreground mb-2 flex-wrap">
                                    <span className="flex items-center gap-1"><BedDouble className="w-3.5 h-3.5" /> {room.beds} {room.bedType} bed{room.beds > 1 ? 's' : ''}</span>
                                    <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" /> Up to {room.maxOccupancy} guests</span>
                                    <span>{room.bathrooms} bath{room.bathrooms !== 1 ? 's' : ''}</span>
                                  </div>
                                  {room.description ? <p className="text-sm text-muted-foreground mb-2">{room.description}</p> : null}
                                  {room.amenities.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {room.amenities.slice(0, 5).map((a) => (
                                        <span key={a} className="text-xs bg-muted px-2 py-0.5 rounded-full">{a}</span>
                                      ))}
                                      {room.amenities.length > 5 && (
                                        <span className="text-xs text-muted-foreground">+{room.amenities.length - 5} more</span>
                                      )}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="font-semibold">{formatCurrency(room.pricePerNight)}<span className="text-sm font-normal text-muted-foreground"> / night</span></p>
                                  {startDateStr && endDateStr ? (
                                    isUnavailable
                                      ? <p className="text-xs text-destructive mt-1">Not available</p>
                                      : <p className="text-xs text-green-700 mt-1">{available} of {room.totalCount} available</p>
                                  ) : (
                                    <p className="text-xs text-muted-foreground mt-1">{room.totalCount} room{room.totalCount !== 1 ? 's' : ''}</p>
                                  )}
                                  {/* Quantity selector - only when this room is selected */}
                                  {isSelected && (
                                    <div className="flex items-center gap-2 mt-2" onClick={e => e.stopPropagation()}>
                                      <span className="text-xs text-muted-foreground">Rooms:</span>
                                      <button
                                        type="button"
                                        onClick={() => setRoomQuantity(q => Math.max(1, q - 1))}
                                        className="w-6 h-6 rounded-full border border-border flex items-center justify-center hover:bg-muted text-sm"
                                      >−</button>
                                      <span className="text-sm font-semibold w-4 text-center">{roomQuantity}</span>
                                      <button
                                        type="button"
                                        onClick={() => setRoomQuantity(q => Math.min(available, q + 1))}
                                        className="w-6 h-6 rounded-full border border-border flex items-center justify-center hover:bg-muted text-sm"
                                      >+</button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Separator />
                </>
              )}

              {/* Amenities */}
              {property.amenities.length > 0 && (
                <>
                  <div>
                    <h2 className="text-2xl font-semibold mb-6">What this place offers</h2>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {property.amenities.map((amenity) => {
                        const IconComponent = iconMap[amenity.icon] || fallbackIcon;
                        return (
                          <div key={amenity.id} className="flex items-center gap-4">
                            <IconComponent className="w-6 h-6" />
                            <span>{amenity.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <Separator />
                </>
              )}

              {/* Date selection */}
              <div>
                {isMonthly ? (
                  <>
                    <h2 className="text-2xl font-semibold mb-2">Choose your move-in date</h2>
                    <p className="text-muted-foreground mb-6 text-sm">
                      This is a {leaseMonths === 12 ? '1-year' : leaseMonths === 24 ? '2-year' : leaseMonths === 36 ? '3-year' : `${leaseMonths}-month`} lease.
                      {moveInDate && effTo && (
                        <> Lease runs {formatDate(moveInDate, 'MMM dd, yyyy')} – {formatDate(effTo, 'MMM dd, yyyy')}.</>
                      )}
                    </p>
                    <div className="flex justify-center">
                      <Calendar
                        mode="single"
                        selected={moveInDate}
                        onSelect={(d) => setMoveInDate(d)}
                        numberOfMonths={2}
                        disabled={isPastDate}
                        className="border rounded-xl p-4"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="text-2xl font-semibold mb-6">Select dates</h2>
                    <div className="flex justify-center">
                      <Calendar
                        mode="range"
                        selected={dateRange}
                        onSelect={handleDateRangeSelect}
                        onDayClick={handleDayClick}
                        modifiers={{ booked: isBookedDate }}
                        modifiersClassNames={{
                          booked: 'line-through opacity-50 text-muted-foreground',
                        }}
                        numberOfMonths={2}
                        disabled={isPastDate}
                        className="border rounded-xl p-4"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Checkout card — mobile only, directly below the calendar */}
              <div className="lg:hidden">{bookingCard}</div>

              <Separator />

              {/* Reviews */}
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <Star className="w-6 h-6 fill-current" />
                  <h2 className="text-2xl font-semibold">
                    {property.rating.toFixed(2)} · {property.reviewCount} reviews
                  </h2>
                </div>

                {reviewCategoryAverages.length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3 mb-8">
                    {reviewCategoryAverages.map((item) => (
                      <div key={item.label} className="flex items-center justify-between border-b border-border pb-2 text-sm">
                        <span className="font-medium">{item.label}</span>
                        <span>{item.value.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                )}

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
                          <div className="flex items-center gap-1">
                            {[1,2,3,4,5].map(n => (
                              <Star key={n} className={`w-3 h-3 ${n <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                            ))}
                            <span className="text-xs text-muted-foreground ml-1">{formatDate(review.createdAt, 'MMMM yyyy')}</span>
                          </div>
                        </div>
                      </div>
                      {review.comment && <p className="text-sm leading-relaxed">{review.comment}</p>}
                      {review.response && (
                        <div className="rounded-xl bg-muted p-4">
                          <p className="text-sm font-semibold mb-1">Host response</p>
                          <p className="text-sm text-muted-foreground leading-relaxed">{review.response}</p>
                        </div>
                      )}
                      {isAuthenticated && (
                        <ReportDialog
                          triggerLabel="Report review"
                          triggerVariant="outline"
                          defaultContentType="review"
                          reportedReviewId={review.id}
                        />
                      )}
                    </div>
                  ))}
                </div>

                {reviews.length === 0 && (
                  <p className="text-muted-foreground text-sm">No reviews yet. Be the first to leave one!</p>
                )}

                {/* Write a review */}
                {(() => {
                  const canReview = isAuthenticated && user?.id !== property.hostId;
                  const alreadyReviewed = reviews.some(r => r.userId === String(user?.id));

                  if (!isAuthenticated) {
                    return (
                      <div className="mt-8 p-4 rounded-xl bg-muted/50 border border-border text-sm text-center">
                        <p className="text-muted-foreground mb-2">Have you stayed here? Share your experience.</p>
                        <Button variant="outline" size="sm" onClick={() => navigate('/login')}>Sign in to rate this property</Button>
                      </div>
                    );
                  }

                  if (!canReview) return null;

                  if (alreadyReviewed) {
                    return (
                      <div className="mt-8 p-4 rounded-xl bg-muted text-sm text-muted-foreground">
                        You have already submitted a review for this property.
                      </div>
                    );
                  }

                  const submitReview = async () => {
                    if (reviewForm.rating === 0) { toast.error('Please select an overall rating'); return; }
                    setReviewSubmitting(true);
                    try {
                      await propertiesAPI.createReview({
                        listing: id!,
                        rating: reviewForm.rating,
                        title: reviewForm.title,
                        content: reviewForm.content,
                        cleanliness: reviewForm.cleanliness || reviewForm.rating,
                        accuracy: reviewForm.accuracy || reviewForm.rating,
                        check_in_rating: reviewForm.check_in_rating || reviewForm.rating,
                        communication: reviewForm.communication || reviewForm.rating,
                        location_rating: reviewForm.location_rating || reviewForm.rating,
                        value: reviewForm.value || reviewForm.rating,
                      });
                      toast.success('Review submitted!');
                      setShowReviewForm(false);
                      setReviewForm({ rating: 0, title: '', content: '', cleanliness: 0, accuracy: 0, check_in_rating: 0, communication: 0, location_rating: 0, value: 0 });
                      queryClient.invalidateQueries({ queryKey: queryKeys.properties.reviews(id!) });
                      queryClient.invalidateQueries({ queryKey: queryKeys.properties.detail(id!) });
                    } catch (err: any) {
                      toast.error(err.message || 'Failed to submit review');
                    } finally {
                      setReviewSubmitting(false);
                    }
                  };

                  return (
                    <div className="mt-8">
                      {!showReviewForm ? (
                        <div className="border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <p className="font-medium text-sm">Rate this property</p>
                            <p className="text-xs text-muted-foreground mt-0.5">Click the stars to leave your rating</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <StarPicker value={reviewForm.rating} onChange={v => { setReviewForm(f => ({ ...f, rating: v })); setShowReviewForm(true); }} />
                            <Button variant="outline" size="sm" onClick={() => setShowReviewForm(true)}>
                              Write a review
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="border border-border rounded-xl p-6 space-y-5">
                          <h3 className="text-lg font-semibold">Rate this property</h3>

                          <div className="space-y-2">
                            <Label>Overall rating <span className="text-destructive">*</span></Label>
                            <StarPicker value={reviewForm.rating} onChange={v => setReviewForm(f => ({ ...f, rating: v }))} />
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                            {([
                              ['Cleanliness', 'cleanliness'],
                              ['Accuracy', 'accuracy'],
                              ['Check-in', 'check_in_rating'],
                              ['Communication', 'communication'],
                              ['Location', 'location_rating'],
                              ['Value', 'value'],
                            ] as [string, keyof typeof reviewForm][]).map(([label, field]) => (
                              <div key={field} className="space-y-1">
                                <Label className="text-xs">{label} <span className="text-muted-foreground">(optional)</span></Label>
                                <StarPicker
                                  value={reviewForm[field] as number}
                                  onChange={v => setReviewForm(f => ({ ...f, [field]: v }))}
                                />
                              </div>
                            ))}
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor="review-content">Comment <span className="text-muted-foreground text-xs">(optional)</span></Label>
                            <Textarea
                              id="review-content"
                              placeholder="Tell others what you liked or didn't like about your stay..."
                              rows={4}
                              value={reviewForm.content}
                              onChange={e => setReviewForm(f => ({ ...f, content: e.target.value }))}
                            />
                          </div>

                          <div className="flex gap-3">
                            <Button
                              type="button"
                              disabled={reviewSubmitting || reviewForm.rating === 0}
                              onClick={submitReview}
                            >
                              {reviewSubmitting ? 'Submitting…' : 'Submit review'}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => setShowReviewForm(false)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <Separator />

              {/* Location */}
              <div>
                <h2 className="text-2xl font-semibold mb-6">Where you'll be</h2>
                <p className="text-muted-foreground mb-4">
                  {property.location.city}, {property.location.state}, {property.location.country}
                </p>
                <LiberiaMap
                  lat={property.location.lat}
                  lng={property.location.lng}
                  address={[
                    property.location.address,
                    property.location.city,
                    property.location.state,
                    property.location.country,
                  ].filter(Boolean).join(', ')}
                  popupLabel={property.title}
                  className="h-[400px] w-full rounded-xl overflow-hidden relative"
                />
              </div>

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
                      <p>{cancellationPolicy?.name || property.cancellationPolicy}</p>
                      <p>{cancellationPolicy?.description}</p>
                      <p>{cancellationPolicy?.details}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Booking Widget — sticky sidebar on desktop. On mobile it's
                rendered inline directly below the calendar (see above). */}
            <div className="hidden lg:block lg:col-span-1 lg:order-2">
              <div className="sticky top-24">
                {bookingCard}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky CTA */}
      <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 bg-white border-t border-border px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <span className="text-lg font-semibold">{formatCurrency(property.price)}</span>
          <span className="text-muted-foreground text-sm"> / {priceUnit}</span>
          {nights > 0 && pricing && (
            <p className="text-xs text-muted-foreground">
              {pricing.pricingType === 'monthly'
                ? `${pricing.monthsUpfront || 1} month${(pricing.monthsUpfront || 1) > 1 ? 's' : ''} upfront · ${formatCurrency(pricing.total)} total`
                : `${nights} nights · ${formatCurrency(pricing.total)} total`}
            </p>
          )}
        </div>
        {isOwner ? (
          <Button variant="outline" size="lg" onClick={() => navigate('/host')}>Your listing</Button>
        ) : (
          <Button onClick={handleReserve} size="lg">Reserve</Button>
        )}
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

              <div className="flex-1 flex items-center justify-center relative"
                onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                onTouchEnd={(e) => {
                  const delta = touchStartX.current - e.changedTouches[0].clientX;
                  if (Math.abs(delta) > 40) {
                    const total = property.images.length;
                    setSelectedImageIndex(prev => delta > 0 ? (prev + 1) % total : (prev - 1 + total) % total);
                  }
                }}
              >
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
