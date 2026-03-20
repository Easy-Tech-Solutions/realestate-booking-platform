import React, { useState } from 'react';
import { Filter, Map as MapIcon } from 'lucide-react';
import { Button } from '../components/ui/button';
import { PropertyCard } from '../components/PropertyCard';
import { FiltersDialog } from '../components/FiltersDialog';
import { mockProperties } from '../../services/mock-data';
import { useApp } from '../../core/context';

export function Search() {
  const { searchFilters } = useApp();
  const [showMap, setShowMap] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [properties] = useState(mockProperties);

  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-6">
          {/* Filters Bar */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {searchFilters.location && `${searchFilters.location} · `}
                {searchFilters.checkIn && searchFilters.checkOut && 'Selected dates · '}
                {searchFilters.guests && `${searchFilters.guests} guests`}
              </p>
              <h1 className="text-2xl font-semibold">
                {properties.length} stays
              </h1>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={() => setShowFilters(true)}>
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowMap(!showMap)}
              >
                <MapIcon className="w-4 h-4 mr-2" />
                {showMap ? 'Hide map' : 'Show map'}
              </Button>
            </div>
          </div>

          {/* Results Grid */}
          <div className={showMap ? 'grid lg:grid-cols-2 gap-6' : ''}>
            <div className={showMap ? '' : 'w-full'}>
              <div className={`grid ${showMap ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'} gap-6 gap-y-8`}>
                {properties.map((property) => (
                  <PropertyCard key={property.id} property={property} />
                ))}
              </div>
            </div>

            {/* Map */}
            {showMap && (
              <div className="sticky top-24 h-[calc(100vh-8rem)] bg-muted rounded-xl flex items-center justify-center">
                <p className="text-muted-foreground">Map view</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <FiltersDialog open={showFilters} onClose={() => setShowFilters(false)} />
    </>
  );
}