import React, { useState, useMemo } from 'react';
import { Filter, Map as MapIcon, BookmarkPlus, Scale } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { toast } from 'sonner';
import { createPriceMarker, LIBERIA_CENTER, LIBERIA_ZOOM } from '../components/LiberiaMap';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { PropertyCard } from '../components/PropertyCard';
import { FiltersDialog, ActiveFilters } from '../components/FiltersDialog';
import { PropertyGridSkeleton } from '../components/Skeletons';
import { useApp } from '../../hooks/useApp';
import { useNavigate } from 'react-router';
import { formatCurrency } from '../../core/utils';
import { useSearchProperties } from '../../hooks/queries/useSearchProperties';
import { bookingToolsAPI } from '../../services/api/booking-tools';

const MIN_COMPARE = 2;
const MAX_COMPARE = 4;

function MapAutoFit({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  React.useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 13);
    } else {
      map.fitBounds(L.latLngBounds(positions), { padding: [40, 40] });
    }
  }, [positions, map]);
  return null;
}

export function Search() {
  const { searchFilters, isAuthenticated } = useApp();
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

  // Save search
  const [showSaveSearch, setShowSaveSearch] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState('');
  const [saveSearchFrequency, setSaveSearchFrequency] = useState<'instantly' | 'daily' | 'weekly'>('daily');
  const [savingSearch, setSavingSearch] = useState(false);

  const handleSaveSearch = async () => {
    if (!saveSearchName.trim()) {
      toast.error('Give your saved search a name');
      return;
    }
    setSavingSearch(true);
    try {
      await bookingToolsAPI.createSavedSearch({
        name: saveSearchName.trim(),
        min_price: activeFilters.priceRange[0] > 0 ? activeFilters.priceRange[0] : undefined,
        max_price: activeFilters.priceRange[1] < 10000 ? activeFilters.priceRange[1] : undefined,
        property_type: activeFilters.propertyTypes[0] || undefined,
        min_bedrooms: activeFilters.bedrooms ?? undefined,
        address: searchFilters.location || '',
        email_frequency: saveSearchFrequency,
      });
      toast.success('Search saved — find it under Dashboard → Saved Searches.');
      setShowSaveSearch(false);
      setSaveSearchName('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save search');
    } finally {
      setSavingSearch(false);
    }
  };

  // Compare
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showCreateComparison, setShowCreateComparison] = useState(false);
  const [comparisonName, setComparisonName] = useState('');
  const [creatingComparison, setCreatingComparison] = useState(false);

  const toggleCompareSelection = (id: string) => {
    setSelectedForCompare((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_COMPARE) {
        toast.error(`You can compare up to ${MAX_COMPARE} properties at a time.`);
        return prev;
      }
      return [...prev, id];
    });
  };

  const handleCreateComparison = async () => {
    if (!comparisonName.trim()) {
      toast.error('Give your comparison a name');
      return;
    }
    setCreatingComparison(true);
    try {
      await bookingToolsAPI.createComparison({
        name: comparisonName.trim(),
        listing_ids: selectedForCompare.map((id) => Number(id)),
      });
      toast.success('Comparison created — find it under Dashboard → Comparisons.');
      setShowCreateComparison(false);
      setComparisonName('');
      setSelectedForCompare([]);
      setCompareMode(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create comparison');
    } finally {
      setCreatingComparison(false);
    }
  };

  return (
    <>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {searchFilters.location && `${searchFilters.location} · `}
                {searchFilters.guests && `${searchFilters.guests} guests`}
              </p>
              <h1 className="text-xl sm:text-2xl font-semibold">
                {filtered.length} stay{filtered.length !== 1 ? 's' : ''}
                {hasActiveFilters && <span className="text-sm sm:text-base font-normal text-muted-foreground ml-2">· Filters applied</span>}
              </h1>
            </div>
            <div className="flex flex-wrap gap-2 sm:gap-3">
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
              {isAuthenticated && (
                <Button variant="outline" size="sm" onClick={() => setShowSaveSearch(true)}>
                  <BookmarkPlus className="w-4 h-4 mr-2" />
                  Save search
                </Button>
              )}
              {isAuthenticated && (
                <Button
                  variant={compareMode ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setCompareMode((v) => !v);
                    if (compareMode) setSelectedForCompare([]);
                  }}
                >
                  <Scale className="w-4 h-4 mr-2" />
                  {compareMode ? 'Cancel compare' : 'Compare'}
                </Button>
              )}
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
                <div className={`grid ${showMap ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'} gap-3 gap-y-6`}>
                  {filtered.map((property) => (
                    <div
                      key={property.id}
                      className="relative"
                      onMouseEnter={() => setHoveredId(property.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      {compareMode && (
                        <label
                          className="absolute top-2 left-2 z-10 flex items-center gap-1.5 rounded-full bg-card/95 border border-border px-2 py-1 shadow-sm cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedForCompare.includes(property.id)}
                            onCheckedChange={() => toggleCompareSelection(property.id)}
                          />
                          <span className="text-xs font-medium">Compare</span>
                        </label>
                      )}
                      <PropertyCard property={property} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {showMap && (
              <div className="sticky top-24 h-[calc(100vh-8rem)] rounded-xl overflow-hidden">
                <MapContainer
                  center={LIBERIA_CENTER}
                  zoom={LIBERIA_ZOOM}
                  style={{ height: '100%', width: '100%' }}
                  scrollWheelZoom={false}
                  maxBounds={[[2, -15], [10, -6]]}
                  maxBoundsViscosity={0.8}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  {(() => {
                    const positions = filtered
                      .filter(p => p.location.lat && p.location.lng)
                      .map(p => [p.location.lat, p.location.lng] as [number, number]);
                    return (
                      <>
                        <MapAutoFit positions={positions} />
                        {filtered.map(p => p.location.lat && p.location.lng ? (
                          <Marker
                            key={p.id}
                            position={[p.location.lat, p.location.lng]}
                            icon={createPriceMarker(p.price, hoveredId === p.id)}
                          >
                            <Popup>
                              <button
                                onClick={() => navigate(`/rooms/${p.id}`)}
                                className="font-semibold text-sm hover:underline block mb-1"
                              >
                                {p.title}
                              </button>
                              <p className="text-xs text-gray-500">{formatCurrency(p.price)}/{p.pricingType === 'monthly' ? 'month' : 'night'}</p>
                            </Popup>
                          </Marker>
                        ) : null)}
                      </>
                    );
                  })()}
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

      {compareMode && selectedForCompare.length >= MIN_COMPARE && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-card border border-border rounded-full shadow-lg px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium">{selectedForCompare.length} selected</span>
          <Button size="sm" onClick={() => setShowCreateComparison(true)}>
            <Scale className="w-4 h-4 mr-1" /> Compare
          </Button>
        </div>
      )}

      <Dialog open={showSaveSearch} onOpenChange={setShowSaveSearch}>
        <DialogContent>
          <DialogHeader><DialogTitle>Save this search</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="saved-search-name">Name</Label>
              <Input
                id="saved-search-name"
                placeholder="e.g. Beach apartments under $150"
                value={saveSearchName}
                onChange={(e) => setSaveSearchName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email me about new matches</Label>
              <Select value={saveSearchFrequency} onValueChange={(v) => setSaveSearchFrequency(v as typeof saveSearchFrequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="instantly">Instantly</SelectItem>
                  <SelectItem value="daily">Daily digest</SelectItem>
                  <SelectItem value="weekly">Weekly digest</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              We'll save your current filters (location, price range, bedrooms, property type) with this search.
            </p>
            <div className="flex gap-2">
              <Button onClick={handleSaveSearch} disabled={savingSearch}>
                {savingSearch ? 'Saving…' : 'Save search'}
              </Button>
              <Button variant="outline" onClick={() => setShowSaveSearch(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showCreateComparison} onOpenChange={setShowCreateComparison}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create a comparison</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Comparing {selectedForCompare.length} properties.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="comparison-name">Name</Label>
              <Input
                id="comparison-name"
                placeholder="e.g. Weekend getaway options"
                value={comparisonName}
                onChange={(e) => setComparisonName(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreateComparison} disabled={creatingComparison}>
                {creatingComparison ? 'Creating…' : 'Create comparison'}
              </Button>
              <Button variant="outline" onClick={() => setShowCreateComparison(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
