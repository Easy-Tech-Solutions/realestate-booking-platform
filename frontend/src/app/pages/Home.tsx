import React, { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search, Star, Quote, Navigation, Loader2, PenLine, X, ArrowRight, Car, Leaf, Landmark } from 'lucide-react';
import bannerImage from '../../assets/banner.jpeg';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PropertyCard } from '../components/PropertyCard';
import { PROPERTY_CATEGORIES } from '../../core/constants';
import { cn } from '../../core/utils';
import { useHomeProperties } from '../../hooks/queries/useHomeProperties';
import { useUserLocation } from '../../hooks/useUserLocation';
import { propertiesAPI } from '../../services/api.service';
import { testimonialsAPI } from '../../services/api/testimonials';
import { useApp } from '../../hooks/useApp';
import { Link } from 'react-router';

function CategorySvgIcon({ id, className = 'w-8 h-8' }: { id: string; className?: string }) {
  const s = {
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor' as const,
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  };
  switch (id) {
    case 'apartment':
      return (
        <svg {...s}>
          {/* ground */}
          <path d="M1 22h22" />
          {/* building body */}
          <rect x="4" y="9" width="16" height="13" rx="0.5" />
          {/* roof */}
          <path d="M2 9L12 2L22 9" />
          {/* top windows */}
          <rect x="6" y="11" width="4" height="3" rx="0.3" />
          <rect x="14" y="11" width="4" height="3" rx="0.3" />
          {/* bottom windows */}
          <rect x="6" y="16" width="4" height="3" rx="0.3" />
          <rect x="14" y="16" width="4" height="3" rx="0.3" />
          {/* door */}
          <path d="M10 22v-5h4v5" />
        </svg>
      );
    case 'hotels':
      return (
        <svg {...s}>
          {/* building */}
          <rect x="2" y="3" width="20" height="19" rx="0.5" />
          {/* floor lines */}
          <line x1="2" y1="9" x2="22" y2="9" />
          <line x1="2" y1="14" x2="22" y2="14" />
          {/* top-row windows */}
          <rect x="5" y="5" width="3" height="3" rx="0.3" />
          <rect x="11" y="5" width="3" height="3" rx="0.3" />
          <rect x="17" y="5" width="3" height="3" rx="0.3" />
          {/* mid-row windows */}
          <rect x="5" y="10" width="3" height="3" rx="0.3" />
          <rect x="11" y="10" width="3" height="3" rx="0.3" />
          <rect x="17" y="10" width="3" height="3" rx="0.3" />
          {/* door */}
          <rect x="9" y="17" width="6" height="5" rx="0.3" />
          {/* canopy */}
          <path d="M6 15q6-4 12 0" strokeWidth="1.2" />
        </svg>
      );
    case 'lodge':
      return (
        <svg {...s}>
          {/* ground */}
          <path d="M1 22h22" />
          {/* walls */}
          <rect x="4" y="13" width="16" height="9" rx="0.5" />
          {/* roof */}
          <path d="M1 13L12 4L23 13" />
          {/* chimney */}
          <rect x="15" y="5" width="3" height="8" />
          {/* windows */}
          <rect x="6" y="15" width="4" height="4" rx="0.3" />
          <rect x="14" y="15" width="4" height="4" rx="0.3" />
          {/* door */}
          <path d="M10 22v-5h4v5" />
        </svg>
      );
    case 'beaches':
      return (
        <svg {...s}>
          {/* umbrella dome */}
          <path d="M3 14a9 9 0 0 1 18 0" />
          {/* pole */}
          <line x1="12" y1="5" x2="12" y2="20" />
          {/* pole curl */}
          <path d="M12 18q3 2 1 4" />
          {/* waves */}
          <path d="M2 17q2-2 4 0t4 0" />
          <path d="M14 17q2-2 4 0t4 0" />
        </svg>
      );
    case 'roadside':
      return (
        <svg {...s}>
          {/* road */}
          <path d="M10 22L13 4M14 22L11 4" />
          <line x1="10" y1="22" x2="14" y2="22" />
          <line x1="11" y1="4" x2="13" y2="4" />
          {/* center dashes */}
          <line x1="12" y1="8" x2="12" y2="11" strokeDasharray="2 2" />
          <line x1="12" y1="14" x2="12" y2="17" strokeDasharray="2 2" />
          {/* trees */}
          <circle cx="5" cy="16" r="3" />
          <line x1="5" y1="19" x2="5" y2="22" />
          <circle cx="19" cy="16" r="3" />
          <line x1="19" y1="19" x2="19" y2="22" />
        </svg>
      );
    case 'office-space':
      return (
        <svg {...s}>
          {/* building tower */}
          <rect x="3" y="2" width="18" height="20" rx="0.5" />
          {/* window grid 3×3 */}
          <rect x="6" y="5" width="3" height="2.5" rx="0.3" />
          <rect x="11" y="5" width="3" height="2.5" rx="0.3" />
          <rect x="16" y="5" width="3" height="2.5" rx="0.3" />
          <rect x="6" y="10" width="3" height="2.5" rx="0.3" />
          <rect x="11" y="10" width="3" height="2.5" rx="0.3" />
          <rect x="16" y="10" width="3" height="2.5" rx="0.3" />
          <rect x="6" y="15" width="3" height="2.5" rx="0.3" />
          <rect x="11" y="15" width="3" height="2.5" rx="0.3" />
          <rect x="16" y="15" width="3" height="2.5" rx="0.3" />
          {/* door */}
          <rect x="9" y="19" width="6" height="3" rx="0.3" />
        </svg>
      );
    case 'highway':
      return <Car {...{ className, strokeWidth: 1.5 }} />;
    case 'land':
      return <Leaf {...{ className, strokeWidth: 1.5 }} />;
    case 'hall':
      return <Landmark {...{ className, strokeWidth: 1.5 }} />;
    default:
      return (
        <svg {...s}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 22V9" />
        </svg>
      );
  }
}

export function Home() {
  const navigate = useNavigate();
  const { isAuthenticated, user } = useApp();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [scrollPosition, setScrollPosition] = useState(0);
  const categoryScrollRef = React.useRef<HTMLDivElement>(null);
  const categoriesQuery = useQuery({
    queryKey: ['property-categories'],
    queryFn: () => propertiesAPI.listCategories(),
  });
  const categories = (categoriesQuery.data || []).length
    ? (categoriesQuery.data || []).map((category) => {
        const fallback = PROPERTY_CATEGORIES.find((item) => item.id === category.slug);
        return {
          id: category.slug,
          name: category.name,
          icon: fallback?.icon || '🏷️',
        };
      })
    : PROPERTY_CATEGORIES;
  const propertiesQuery = useHomeProperties(selectedCategory);
  const properties = propertiesQuery.data || [];
  const isLoading = propertiesQuery.isLoading;

  const platformStatsQuery = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => propertiesAPI.getPlatformStats(),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
  const formatStat = (n: number): string => {
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k+`;
    return `${n}+`;
  };

  const queryClient = useQueryClient();
  const testimonialsQuery = useQuery({
    queryKey: ['testimonials'],
    queryFn: () => testimonialsAPI.getAll(),
    staleTime: 5 * 60 * 1000,
  });
  const testimonials = testimonialsQuery.data ?? [];

  const [showTestimonialForm, setShowTestimonialForm] = useState(false);
  const [tForm, setTForm] = useState({ rating: 5, quote: '' });
  const [tSubmitting, setTSubmitting] = useState(false);
  const [tError, setTError] = useState('');
  const [tSuccess, setTSuccess] = useState(false);

  const submitTestimonial = async (e: React.FormEvent) => {
    e.preventDefault();
    setTError('');
    if (!tForm.quote.trim()) { setTError('Please write a message.'); return; }
    if (tForm.quote.trim().length < 5) { setTError('Message must be at least 5 characters.'); return; }
    setTSubmitting(true);
    try {
      await testimonialsAPI.create({ rating: tForm.rating, quote: tForm.quote.trim() });
      setTSuccess(true);
      setTForm({ rating: 5, quote: '' });
      queryClient.invalidateQueries({ queryKey: ['testimonials'] });
      setTimeout(() => { setTSuccess(false); setShowTestimonialForm(false); }, 3000);
    } catch (err: any) {
      setTError(err.message || 'Failed to submit. Please try again.');
    } finally {
      setTSubmitting(false);
    }
  };

  const { location: userLocation } = useUserLocation();
  const nearbyQuery = useQuery({
    queryKey: ['nearby-listings', userLocation?.lat, userLocation?.lng],
    queryFn: () => propertiesAPI.getNearby(userLocation!.lat, userLocation!.lng),
    enabled: !!userLocation,
    staleTime: 5 * 60 * 1000,
  });
  const nearbyProperties = nearbyQuery.data ?? [];

  const propertiesSectionRef = useRef<HTMLDivElement>(null);

  const scrollToProperties = () => {
    propertiesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const scrollCategories = (direction: 'left' | 'right') => {
    if (categoryScrollRef.current) {
      const scrollAmount = 300;
      const newPosition = direction === 'left'
        ? scrollPosition - scrollAmount
        : scrollPosition + scrollAmount;
      categoryScrollRef.current.scrollLeft = newPosition;
      setScrollPosition(newPosition);
    }
  };

  return (
    <div className="min-h-screen bg-background">

      {/* ── Hero Banner ── */}
      {!selectedCategory && (
        <div className="border-b border-border">
          <img
            src={bannerImage}
            alt="HomeKonet — Find Your Perfect Stay"
            className="block w-full h-[220px] sm:h-[320px] md:h-[420px] lg:h-[500px] xl:h-[560px] object-cover object-center"
          />
        </div>
      )}

      {/* ── Categories ── */}
      <div ref={propertiesSectionRef} className="sticky top-20 z-40 bg-background border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20">
          <div className="relative">
            {scrollPosition > 0 && (
              <button
                onClick={() => scrollCategories('left')}
                aria-label="Scroll categories left"
                title="Scroll categories left"
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-border shadow-md flex items-center justify-center hover:shadow-lg transition-shadow"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div
              ref={categoryScrollRef}
              className="flex justify-center gap-4 sm:gap-6 md:gap-8 py-4 overflow-x-auto scrollbar-hide scroll-smooth"
            >
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(selectedCategory === category.id ? null : category.id)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 pb-2 border-b-2 transition-all flex-shrink-0',
                    selectedCategory === category.id
                      ? 'border-primary text-primary'
                      : 'border-transparent text-primary/50 hover:text-primary hover:border-primary/30'
                  )}
                >
                  <CategorySvgIcon id={category.id} className="w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8" />
                  <span className="text-xs font-semibold whitespace-nowrap">{category.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => scrollCategories('right')}
              aria-label="Scroll categories right"
              title="Scroll categories right"
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-border shadow-md flex items-center justify-center hover:shadow-lg transition-shadow"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Near You */}
      {!selectedCategory && nearbyProperties.length > 0 && (
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 pt-8">
          <div className="flex items-center gap-2 mb-4">
            <Navigation className="w-4 h-4 text-primary" />
            <h2 className="text-lg font-semibold">Near you</h2>
            <span className="text-xs text-muted-foreground ml-1">within 50 km</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            {nearbyProperties.map((property) => (
              <div key={property.id} className="relative shrink-0 w-52">
                <PropertyCard property={property} />
                <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded-full backdrop-blur-sm pointer-events-none">
                  {property.distanceKm} km
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Properties Grid */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-8">
        {selectedCategory && (
          <div className="mb-6">
            <h2 className="text-2xl font-semibold">
              {categories.find(c => c.id === selectedCategory)?.name}
            </h2>
            <p className="text-muted-foreground">
              {properties.length} stay{properties.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 gap-y-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-60 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : properties.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 gap-y-6">
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted-foreground text-lg">No properties found</p>
          </div>
        )}
      </div>

      {/* ── Value Proposition ── */}
      {!selectedCategory && (
        <div className="border-t border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-20">
            <div className="flex flex-col lg:flex-row items-center gap-12">
              {/* Text + CTAs */}
              <div className="flex-1 text-center lg:text-left">
                <h2 className="text-4xl sm:text-5xl font-semibold leading-tight tracking-tight mb-4">
                  Find Your<br className="hidden sm:block" /> Perfect Stay
                </h2>
                <p className="text-muted-foreground text-lg max-w-lg mx-auto lg:mx-0 mb-8">
                  Discover homes, hotels, and lodges across Liberia — from the beaches of Robertsport
                  to the heart of Monrovia. Book with confidence.
                </p>
                <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                  <button
                    type="button"
                    onClick={scrollToProperties}
                    className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
                  >
                    Explore Properties <ArrowRight className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Logged-in users go straight to the create-listing flow.
                      // Logged-out clickers are sent to signup — most people
                      // hitting this CTA for the first time don't have an
                      // account yet, so defaulting to login adds friction.
                      if (isAuthenticated) {
                        navigate('/host/new');
                      } else {
                        navigate('/login?mode=signup&next=' + encodeURIComponent('/host/new'));
                      }
                    }}
                    className="flex items-center gap-2 px-6 py-3 border border-border rounded-xl font-semibold text-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    List Your Property
                  </button>
                </div>
              </div>

              {/* Stats */}
              <div className="shrink-0 grid grid-cols-3 gap-6 text-center lg:text-left">
                {platformStatsQuery.data ? (
                  <>
                    <div>
                      <p className="text-3xl font-bold text-primary">{formatStat(platformStatsQuery.data.total_locations)}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wide">Locations</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-primary">{formatStat(platformStatsQuery.data.total_properties)}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wide">Properties</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-primary">{formatStat(platformStatsQuery.data.happy_guests)}</p>
                      <p className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wide">Happy Guests</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-3xl font-bold text-primary">10+</p>
                      <p className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wide">Locations</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-primary">200+</p>
                      <p className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wide">Properties</p>
                    </div>
                    <div>
                      <p className="text-3xl font-bold text-primary">1k+</p>
                      <p className="text-xs text-muted-foreground mt-1 font-medium uppercase tracking-wide">Happy Guests</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Testimonials ── */}
      {!selectedCategory && (
        <div className="bg-muted/30 border-t border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-20">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-12">
              <div>
                <h2 className="text-3xl sm:text-4xl font-semibold mb-3">What our guests say</h2>
                <p className="text-muted-foreground text-lg max-w-xl">
                  Real experiences from real travelers who found their perfect stay on HomeKonet.
                </p>
              </div>
              {!showTestimonialForm && (
                isAuthenticated ? (
                  <button
                    type="button"
                    onClick={() => setShowTestimonialForm(true)}
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl border border-primary text-primary text-sm font-semibold hover:bg-primary hover:text-primary-foreground transition-colors"
                  >
                    <PenLine className="w-4 h-4" /> Share your experience
                  </button>
                ) : (
                  <Link
                    to="/login"
                    className="shrink-0 flex items-center gap-2 px-5 py-2.5 rounded-xl border border-border text-muted-foreground text-sm font-medium hover:border-primary hover:text-primary transition-colors"
                  >
                    Sign in to share your experience
                  </Link>
                )
              )}
            </div>

            {/* Submit form */}
            {showTestimonialForm && (
              <div className="mb-10 bg-background rounded-2xl border border-border p-6 max-w-xl">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-semibold text-lg">Share your experience</h3>
                  <button type="button" aria-label="Close form" onClick={() => { setShowTestimonialForm(false); setTError(''); setTSuccess(false); }} className="text-muted-foreground hover:text-foreground">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                {tSuccess ? (
                  <p className="text-green-700 font-medium text-sm">Thank you! Your testimonial has been posted.</p>
                ) : (
                  <form onSubmit={submitTestimonial} className="space-y-4">
                    {/* Posting as */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                      {user?.avatar ? (
                        <img src={user.avatar} alt={user.firstName} className="w-9 h-9 rounded-full object-cover shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                          {(user?.firstName?.[0] ?? '') + (user?.lastName?.[0] ?? '')}
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground">Posting as</p>
                        <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-2">Rating *</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map(n => (
                          <button
                            key={n}
                            type="button"
                            aria-label={`Rate ${n} star${n !== 1 ? 's' : ''}`}
                            onClick={() => setTForm(f => ({ ...f, rating: n }))}
                            className="p-0.5"
                          >
                            <Star className={cn('w-6 h-6 transition-colors', n <= tForm.rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40 hover:text-yellow-300')} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground block mb-1">Your message *</label>
                      <textarea
                        value={tForm.quote}
                        onChange={e => setTForm(f => ({ ...f, quote: e.target.value }))}
                        rows={4}
                        placeholder="Tell us about your experience on HomeKonet…"
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                        required
                      />
                    </div>
                    {tError && <p className="text-destructive text-xs">{tError}</p>}
                    <button
                      type="submit"
                      disabled={tSubmitting}
                      className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60"
                    >
                      {tSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting…</> : 'Submit testimonial'}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Testimonials grid */}
            {testimonialsQuery.isLoading ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-48 bg-muted rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : testimonials.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Quote className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="font-medium">No testimonials yet.</p>
                <p className="text-sm mt-1">Be the first to share your experience!</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {testimonials.map((t) => {
                  const colorClass = `bg-${t.avatar_color}-600`;
                  return (
                    <div key={t.id} className="bg-background rounded-2xl border border-border p-6 flex flex-col gap-4">
                      <Quote className="w-6 h-6 text-primary/40 flex-shrink-0" />
                      <p className="text-sm leading-relaxed text-foreground flex-1">{t.quote}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className={cn('w-3.5 h-3.5', i < t.rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        {t.user_avatar ? (
                          <img src={t.user_avatar} alt={t.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0', colorClass)}>
                            {t.avatar_initials}
                          </div>
                        )}
                        <div>
                          <p className="font-semibold text-sm">{t.name}</p>
                          {t.location && <p className="text-xs text-muted-foreground">{t.location}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Trusted Partners ── */}
      {!selectedCategory && (
        <div className="border-t border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-20">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-semibold mb-3">Trusted partners</h2>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                We work with leading organisations to ensure every booking is safe, legal, and well-supported.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-12 max-w-2xl mx-auto">
              {/* Payment Partners */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">Payment</h3>
                <div className="grid grid-cols-1 gap-4">
                  {[
                    { name: 'MTN Mobile Money', abbr: 'MTN', color: 'bg-yellow-400 text-yellow-900', desc: 'Official mobile money partner' },
                  ].map((p) => (
                    <div key={p.name} className="flex items-center gap-3 p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                      <div className={`w-12 h-12 rounded-xl ${p.color} flex items-center justify-center text-xs font-bold flex-shrink-0`}>
                        {p.abbr}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Legal & Compliance */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">Legal &amp; Compliance</h3>
                <div className="grid grid-cols-1 gap-4">
                  {[
                    { name: 'Liberia Revenue Authority', abbr: 'LRA', color: 'bg-slate-700 text-white', desc: 'Tax compliance' },
                    { name: 'Ministry of Commerce', abbr: 'MC', color: 'bg-red-700 text-white', desc: 'Business licensing' },
                  ].map((p) => (
                    <div key={p.name} className="flex items-center gap-3 p-4 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                      <div className={`w-12 h-12 rounded-xl ${p.color} flex items-center justify-center text-xs font-bold flex-shrink-0`}>
                        {p.abbr}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-center text-xs text-muted-foreground mt-10">
              HomeKonet operates in full compliance with Liberian commercial law and all applicable regulations.
              All transactions are processed through licensed financial institutions.
            </p>
          </div>
        </div>
      )}

      {/* Host CTA Banner */}
      {!selectedCategory && (
        <div className="bg-gradient-to-r from-primary to-primary/80 text-white">
          <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-16 flex flex-col md:flex-row items-center justify-between gap-8">
            <div>
              <h2 className="text-3xl font-semibold mb-3">Become a host</h2>
              <p className="text-white/80 text-lg max-w-md">
                Earn extra income and unlock new opportunities by sharing your space.
              </p>
            </div>
            <button
              onClick={() => navigate('/host/new')}
              className="flex-shrink-0 px-8 py-4 bg-white text-primary font-semibold rounded-xl hover:bg-white/90 transition-colors"
            >
              Try hosting
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
