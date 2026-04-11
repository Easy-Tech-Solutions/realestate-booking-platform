import React, { useState, useMemo } from 'react';
import { Filter, Map as MapIcon } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { Button } from '../components/ui/button';
import { PropertyCard } from '../components/PropertyCard';
import { FiltersDialog, ActiveFilters } from '../components/FiltersDialog';
import { PropertyGridSkeleton } from '../components/Skeletons';
import { useApp } from '../../hooks/useApp';
import { useNavigate } from 'react-router';
import { formatCurrency } from '../../core/utils';
import { useSearchProperties } from '../../hooks/queries/useSearchProperties';

function createPriceIcon(price: number, hovered: boolean) {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${hovered ? '#004406' : '#fff'};
      color:${hovered ? '#fff' : '#000'};
      border:2px solid #004406;
      border-radius:20px;
      padding:4px 10px;
      font-size:13px;
      font-weight:700;
      white-space:nowrap;
      box-shadow:0 2px 8px rgba(0,0,0,0.2);
      cursor:pointer;
    ">${formatCurrency(price)}</div>`,
    iconAnchor: [30, 16],
  });
}

export function Search() {
  const { searchFilters } = useApp();
  const navigate = useNavigate();
  const [showMap, setShowMap] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const searchQuery = useSearchProperties(searchFilters);
  const allProperties = useMemo(() => searchQuery.data || [], [searchQuery.data]);
  const isLoading = searchQuery.isLoading;
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    priceRange: [0, 10000],
    propertyTypes: [],
    amenities: [],
    bedrooms: null,
    beds: null,
    bathrooms: null,
    instantBook: false,
    superhost: false,
  });

  const filtered = useMemo(() => {
    return allProperties.filter(p => {
      if (p.price < activeFilters.priceRange[0] || p.price > activeFilters.priceRange[1]) return false;
      if (activeFilters.propertyTypes.length > 0 && !activeFilters.propertyTypes.includes(p.propertyType)) return false;
      if (activeFilters.amenities.length > 0 && !activeFilters.amenities.every(a => p.amenities.some(pa => pa.id === a))) return false;
      if (activeFilters.bedrooms !== null && p.bedrooms < activeFilters.bedrooms) return false;
      if (activeFilters.beds !== null && p.beds < activeFilters.beds) return false;
      if (activeFilters.bathrooms !== null && p.bathrooms < activeFilters.bathrooms) return false;
      if (activeFilters.instantBook && !p.instantBook) return false;
      if (activeFilters.superhost && !p.isSuperhost) return false;
      return true;
    });
  }, [allProperties, activeFilters]);

  const hasActiveFilters =
    activeFilters.propertyTypes.length > 0 ||
    activeFilters.amenities.length > 0 ||
    activeFilters.bedrooms !== null ||
    activeFilters.beds !== null ||
    activeFilters.bathrooms !== null ||
    activeFilters.instantBook ||
    activeFilters.superhost;

  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {searchFilters.location && `${searchFilters.location} · `}
                {searchFilters.guests && `${searchFilters.guests} guests`}
              </p>
              <h1 className="text-2xl font-semibold">
                {filtered.length} stay{filtered.length !== 1 ? 's' : ''}
                {hasActiveFilters && <span className="text-base font-normal text-muted-foreground ml-2">· Filters applied</span>}
              </h1>
            </div>
            <div className="flex gap-3">
              <Button
                variant={hasActiveFilters ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowFilters(true)}
              >
                <Filter className="w-4 h-4 mr-2" />
                Filters
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowMap(!showMap)}>
                <MapIcon className="w-4 h-4 mr-2" />
                {showMap ? 'Hide map' : 'Show map'}
              </Button>
            </div>
          </div>

          <div className={showMap ? 'grid lg:grid-cols-2 gap-6' : ''}>
            <div className={showMap ? '' : 'w-full'}>
              {isLoading ? (
                <PropertyGridSkeleton count={8} />
              ) : filtered.length === 0 ? (
                <div className="text-center py-24">
                  <p className="text-5xl mb-4">🔍</p>
                  <h2 className="text-2xl font-semibold mb-2">No stays found</h2>
                  <p className="text-muted-foreground mb-6">
                    Try adjusting your filters or search in a different area.
                  </p>
                  <Button
                    onClick={() => setActiveFilters({
                      priceRange: [0, 10000],
                      propertyTypes: [],
                      amenities: [],
                      bedrooms: null,
                      beds: null,
                      bathrooms: null,
                      instantBook: false,
                      superhost: false,
                    })}
                  >
                    Clear all filters
                  </Button>
                </div>
              ) : (
                <div className={`grid ${showMap ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'} gap-6 gap-y-8`}>
                  {filtered.map((property) => (
                    <div
                      key={property.id}
                      onMouseEnter={() => setHoveredId(property.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <PropertyCard property={property} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showMap && (
              <div className="sticky top-24 h-[calc(100vh-8rem)] rounded-xl overflow-hidden">
                <MapContainer
                  center={[6.3, -10.8]}
                  zoom={7}
                  style={{ blockSize: '100%', inlineSize: '100%' }}
                  scrollWheelZoom={false}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {filtered.map(p => p.location.lat && p.location.lng ? (
                    <Marker
                      key={p.id}
                      position={[p.location.lat, p.location.lng]}
                      icon={createPriceIcon(p.price, hoveredId === p.id)}
                    >
                      <Popup>
                        <button
                          onClick={() => navigate(`/rooms/${p.id}`)}
                          className="font-semibold text-sm hover:underline block mb-1"
                        >
                          {p.title}
                        </button>
                        <p className="text-xs text-gray-500">{formatCurrency(p.price)}/night</p>
                      </Popup>
                    </Marker>
                  ) : null)}
                </MapContainer>
              </div>
            )}
          </div>
        </div>
      </div>

      <FiltersDialog
        open={showFilters}
        onClose={() => setShowFilters(false)}
        onApply={setActiveFilters}
      />
    </>
  );
}
