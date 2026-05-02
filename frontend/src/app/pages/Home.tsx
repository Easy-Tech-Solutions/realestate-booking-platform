import React, { useState, useRef } from 'react';
import { ChevronLeft, ChevronRight, Search, MapPin, Star, ArrowRight } from 'lucide-react';
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
                  { icon: MapPin, value: '50+', label: 'Locations' },
                  { value: '500+', label: 'Properties' },
                  { value: '10k+', label: 'Happy Guests' },
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 gap-y-8">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-72 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        ) : properties.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6 gap-4 gap-y-6">
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
