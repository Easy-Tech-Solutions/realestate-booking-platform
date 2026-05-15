import React, { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search, MapPin, Star, ArrowRight, Quote } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { PropertyCard } from '../components/PropertyCard';
import { PROPERTY_CATEGORIES } from '../../core/constants';
import { cn } from '../../core/utils';
import { useHomeProperties } from '../../hooks/queries/useHomeProperties';
import { propertiesAPI } from '../../services/api.service';

export function Home() {
  const navigate = useNavigate();
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
        <div className="relative overflow-hidden bg-[#004406]">
          {/* Decorative blobs */}
          <div className="pointer-events-none absolute -top-32 -right-32 h-[520px] w-[520px] rounded-full bg-white/5" />
          <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-white/5" />
          <div className="pointer-events-none absolute top-1/2 right-1/3 h-40 w-40 -translate-y-1/2 rounded-full bg-emerald-500/10" />

          <div className="container relative z-10 mx-auto px-4 py-20 sm:px-6 lg:px-20">
            <div className="max-w-3xl">

              {/* Badge */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-medium text-white/90 backdrop-blur-sm"
              >
                <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                Trusted by thousands of travelers
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="mb-5 text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl lg:text-7xl"
              >
                Find Your
                <span className="block bg-gradient-to-r from-green-300 to-emerald-100 bg-clip-text text-transparent">
                  Perfect Stay
                </span>
              </motion.h1>

              {/* Sub-headline */}
              <motion.p
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="mb-10 max-w-xl text-lg text-white/70 sm:text-xl"
              >
                Discover unique homes, hotels, and spaces — from city apartments to beachfront villas. Book with confidence.
              </motion.p>

              {/* CTA buttons */}
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="mb-14 flex flex-col gap-4 sm:flex-row"
              >
                <button
                  onClick={scrollToProperties}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-semibold text-[#004406] shadow-lg transition-colors hover:bg-green-50"
                >
                  <Search className="h-5 w-5" />
                  Explore Properties
                </button>
                <button
                  onClick={() => navigate('/host/new')}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-8 py-4 text-base font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                >
                  List Your Property
                  <ArrowRight className="h-5 w-5" />
                </button>
              </motion.div>

              {/* Stats row */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="flex flex-wrap gap-10"
              >
                {[
                  {
                    icon: MapPin,
                    value: platformStatsQuery.data ? formatStat(platformStatsQuery.data.total_locations) : '—',
                    label: 'Locations',
                  },
                  {
                    value: platformStatsQuery.data ? formatStat(platformStatsQuery.data.total_properties) : '—',
                    label: 'Properties',
                  },
                  {
                    value: platformStatsQuery.data ? formatStat(platformStatsQuery.data.happy_guests) : '—',
                    label: 'Happy Guests',
                  },
                ].map((stat) => (
                  <div key={stat.label}>
                    <p className="text-2xl font-bold text-white">{stat.value}</p>
                    <p className="text-sm text-white/55">{stat.label}</p>
                  </div>
                ))}
              </motion.div>

            </div>
          </div>
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
              className="flex gap-8 py-4 overflow-x-auto scrollbar-hide scroll-smooth"
            >
              {categories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(selectedCategory === category.id ? null : category.id)}
                  className={cn(
                    'flex flex-col items-center gap-2 pb-2 border-b-2 transition-colors flex-shrink-0',
                    selectedCategory === category.id
                      ? 'border-foreground opacity-100'
                      : 'border-transparent opacity-60 hover:opacity-100 hover:border-muted'
                  )}
                >
                  <span className="text-2xl">{category.icon}</span>
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

      {/* ── Testimonials ── */}
      {!selectedCategory && (
        <div className="bg-muted/30 border-t border-border">
          <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-20">
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-semibold mb-3">What our guests say</h2>
              <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                Real experiences from real travelers who found their perfect stay on HomeKonet.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                {
                  name: 'Amara Kofi',
                  location: 'Accra, Ghana',
                  rating: 5,
                  avatar: 'AK',
                  color: 'bg-emerald-600',
                  quote: 'HomeKonet made finding a place in Monrovia so easy. The listing photos were accurate and the host was incredibly responsive. Will definitely book again.',
                },
                {
                  name: 'Fatima Diallo',
                  location: 'Dakar, Senegal',
                  rating: 5,
                  avatar: 'FD',
                  color: 'bg-blue-600',
                  quote: 'I was nervous booking online for the first time, but the process was seamless. The MTN MoMo payment worked perfectly and I got instant confirmation.',
                },
                {
                  name: 'James Mensah',
                  location: 'Lagos, Nigeria',
                  rating: 5,
                  avatar: 'JM',
                  color: 'bg-orange-600',
                  quote: 'Stayed at a beautiful apartment in Paynesville. The host was a superhost and everything was exactly as described. Highly recommend HomeKonet.',
                },
                {
                  name: 'Grace Osei',
                  location: 'Kumasi, Ghana',
                  rating: 4,
                  avatar: 'GO',
                  color: 'bg-purple-600',
                  quote: 'Great selection of properties across Liberia. I found a hotel room with all the amenities I needed at a very fair price. The messaging feature made coordination easy.',
                },
                {
                  name: 'Emmanuel Tetteh',
                  location: 'Lomé, Togo',
                  rating: 5,
                  avatar: 'ET',
                  color: 'bg-rose-600',
                  quote: 'The platform is clean and intuitive. I booked a villa for a family trip and the whole experience from search to check-out was flawless. 10/10.',
                },
                {
                  name: 'Mariama Bah',
                  location: 'Conakry, Guinea',
                  rating: 5,
                  avatar: 'MB',
                  color: 'bg-teal-600',
                  quote: 'I love that I can pay with Mobile Money. No need for a credit card. HomeKonet is built for us in West Africa and it shows. Excellent service.',
                },
              ].map((t) => (
                <div key={t.name} className="bg-background rounded-2xl border border-border p-6 flex flex-col gap-4">
                  <Quote className="w-6 h-6 text-primary/40 flex-shrink-0" />
                  <p className="text-sm leading-relaxed text-foreground flex-1">{t.quote}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className={`w-3.5 h-3.5 ${i < t.rating ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full ${t.color} flex items-center justify-center text-white text-sm font-semibold flex-shrink-0`}>
                      {t.avatar}
                    </div>
                    <div>
                      <p className="font-semibold text-sm">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.location}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
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
            <div className="grid md:grid-cols-2 gap-12">
              {/* Marketing Partners */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">Marketing &amp; Distribution</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { name: 'MTN Mobile Money', abbr: 'MTN', color: 'bg-yellow-400 text-yellow-900', desc: 'Official payment partner' },
                    { name: 'Orange Money', abbr: 'OM', color: 'bg-orange-500 text-white', desc: 'Mobile payment network' },
                    { name: 'Liberia Tourism', abbr: 'LT', color: 'bg-[#004406] text-white', desc: 'National tourism board' },
                    { name: 'West Africa Travel', abbr: 'WAT', color: 'bg-blue-600 text-white', desc: 'Regional travel network' },
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

              {/* Legal & Compliance Partners */}
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">Legal &amp; Compliance</h3>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { name: 'Liberia Revenue Authority', abbr: 'LRA', color: 'bg-slate-700 text-white', desc: 'Tax compliance partner' },
                    { name: 'Central Bank of Liberia', abbr: 'CBL', color: 'bg-green-800 text-white', desc: 'Financial regulation' },
                    { name: 'Ministry of Commerce', abbr: 'MC', color: 'bg-red-700 text-white', desc: 'Business licensing' },
                    { name: 'ECOWAS Trade', abbr: 'ECO', color: 'bg-indigo-600 text-white', desc: 'Regional trade body' },
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
              HomeKonet operates in full compliance with Liberian commercial law and ECOWAS regional trade regulations.
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
