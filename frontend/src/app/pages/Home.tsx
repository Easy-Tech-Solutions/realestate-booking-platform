import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PropertyCard } from '../components/PropertyCard';
import { PROPERTY_CATEGORIES } from '../../core/constants';
import { mockProperties } from '../../services/mock-data';
import { cn } from '../../core/utils';

export function Home() {
  const navigate = useNavigate();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [properties, setProperties] = useState(mockProperties);
  const [scrollPosition, setScrollPosition] = useState(0);
  const categoryScrollRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedCategory) {
      setProperties(mockProperties.filter(p => p.category === selectedCategory));
    } else {
      setProperties(mockProperties);
    }
  }, [selectedCategory]);

  const scrollCategories = (direction: 'left' | 'right') => {
    if (categoryScrollRef.current) {
      const scrollAmount = 300;
      const newPosition = direction === 'left' 
        ? scrollPosition - scrollAmount 
        : scrollPosition + scrollAmount;
      
      categoryScrollRef.current.scrollTo({
        left: newPosition,
        behavior: 'smooth'
      });
      setScrollPosition(newPosition);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Categories */}
      <div className="sticky top-20 z-40 bg-background border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20">
          <div className="relative">
            {/* Left Scroll Button */}
            {scrollPosition > 0 && (
              <button
                onClick={() => scrollCategories('left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 rounded-full bg-white border border-border shadow-md flex items-center justify-center hover:shadow-lg transition-shadow"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}

            {/* Categories Scroll Container */}
            <div
              ref={categoryScrollRef}
              className="flex gap-8 py-4 overflow-x-auto scrollbar-hide scroll-smooth"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {PROPERTY_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(
                    selectedCategory === category.id ? null : category.id
                  )}
                  className={cn(
                    "flex flex-col items-center gap-2 pb-2 border-b-2 transition-colors flex-shrink-0",
                    selectedCategory === category.id
                      ? "border-foreground opacity-100"
                      : "border-transparent opacity-60 hover:opacity-100 hover:border-muted"
                  )}
                >
                  <span className="text-2xl">{category.icon}</span>
                  <span className="text-xs font-semibold whitespace-nowrap">
                    {category.name}
                  </span>
                </button>
              ))}
            </div>

            {/* Right Scroll Button */}
            <button
              onClick={() => scrollCategories('right')}
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
              {PROPERTY_CATEGORIES.find(c => c.id === selectedCategory)?.name}
            </h2>
            <p className="text-muted-foreground">
              {properties.length} stay{properties.length !== 1 ? 's' : ''}
            </p>
          </div>
        )}

        {properties.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 gap-y-8">
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="text-muted-foreground text-lg">
              No properties found in this category
            </p>
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

      {/* Inspiration Section */}
      {!selectedCategory && (
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-16 border-t border-border">
          <h2 className="text-2xl font-semibold mb-6">Inspiration for future getaways</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { label: 'Popular', ids: ['1', '5', '12', '8'] },
              { label: 'Arts & culture', ids: ['3', '13', '7', '11'] },
              { label: 'Outdoors', ids: ['2', '14', '16', '20'] },
              { label: 'Mountains', ids: ['2', '6', '18', '19'] },
            ].map(({ label, ids }) => (
              <div key={label} className="space-y-2">
                <h3 className="font-semibold">{label}</h3>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {ids.map(id => {
                    const p = mockProperties.find(mp => mp.id === id);
                    return p ? (
                      <button
                        key={id}
                        onClick={() => navigate(`/rooms/${id}`)}
                        className="block hover:text-foreground hover:underline text-left"
                      >
                        {p.location.city}, {p.location.state}
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
