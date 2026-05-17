import React, { useState } from 'react';
import {
  X, Search, MapPin, Calendar as CalendarIcon, Users,
  Minus, Plus, SlidersHorizontal, Loader2,
} from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { format } from 'date-fns';
import { useApp } from '../../hooks/useApp';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { propertiesAPI } from '../../services/api.service';
import { PROPERTY_CATEGORIES } from '../../core/constants';
import { cn } from '../../core/utils';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

// Liberian cities for quick-pick
const LIBERIA_LOCATIONS = [
  'Monrovia', 'Paynesville', 'Gbarnga', 'Buchanan',
  'Kakata', 'Voinjama', 'Zwedru', 'Harper',
  'Robertsport', 'Tubmanburg',
];


// Category icon fallback map
const CATEGORY_ICONS: Record<string, string> = {
  apartment: '🏠', hotels: '🏨', lodge: '🛖', beaches: '🏖️',
  roadside: '🛣️', highway: '🚗', land: '🌿', 'office-space': '🏢',
  hall: '🏛️', house: '🏡', villa: '🏰', cabin: '🪵',
  resort: '🌴', hotel: '🏨', suite: '🛎️',
};

function Counter({
  label, sub, value, min = 0, onChange,
}: {
  label: string; sub: string; value: number; min?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div>
        <p className="font-medium text-sm">{label}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-primary disabled:opacity-30 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span className="w-6 text-center text-sm font-semibold">{value}</span>
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-primary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const navigate = useNavigate();
  const { setSearchFilters } = useApp();

  const [location, setLocation]         = useState('');
  const [checkIn, setCheckIn]           = useState<Date>();
  const [checkOut, setCheckOut]         = useState<Date>();
  const [selectedType, setSelectedType] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [guests, setGuests] = useState({ adults: 1, children: 0, infants: 0, pets: 0 });

  // Pull categories from backend; fall back to local constants
  const categoriesQuery = useQuery({
    queryKey: ['property-categories'],
    queryFn: () => propertiesAPI.listCategories(),
    staleTime: 5 * 60 * 1000,
  });

  const categories: { id: string; name: string; icon: string }[] = [
    { id: '', name: 'Any', icon: '🔍' },
    ...(categoriesQuery.data && categoriesQuery.data.length > 0
      ? categoriesQuery.data
          .filter((c) => c.is_active)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((c) => ({
            id: c.slug,
            name: c.name,
            icon: CATEGORY_ICONS[c.slug] ??
              PROPERTY_CATEGORIES.find((p) => p.id === c.slug)?.icon ??
              '🏷️',
          }))
      : PROPERTY_CATEGORIES.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))
    ),
  ];

  const totalGuests = guests.adults + guests.children;

  const handleSearch = () => {
    setSearchFilters({
      location: location.trim() || undefined,
      checkIn,
      checkOut,
      adults: guests.adults,
      children: guests.children,
      infants: guests.infants,
      pets: guests.pets,
      guests: totalGuests > 0 ? totalGuests : undefined,
      ...(selectedType ? { propertyType: [selectedType as any] } : {}),
      ...(priceMin ? { priceMin: Number(priceMin) } : {}),
      ...(priceMax ? { priceMax: Number(priceMax) } : {}),
    });
    navigate('/search');
    onClose();
  };

  const reset = () => {
    setLocation('');
    setCheckIn(undefined);
    setCheckOut(undefined);
    setSelectedType('');
    setPriceMin('');
    setPriceMax('');
    setGuests({ adults: 1, children: 0, infants: 0, pets: 0 });
  };

  const hasAnyFilter =
    Boolean(location) || Boolean(checkIn) || Boolean(checkOut) ||
    Boolean(selectedType) || Boolean(priceMin) || Boolean(priceMax) ||
    guests.children > 0 || guests.adults > 1;

  const searchLabel = location.trim()
    ? `Search in ${location.trim()}`
    : selectedType
      ? `Search ${categories.find((c) => c.id === selectedType)?.name ?? 'properties'}`
      : 'Search all properties';

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-[640px] p-0 gap-0 max-h-[92vh] overflow-y-auto rounded-2xl">

        {/* ── Header ── */}
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <h2 className="font-semibold text-base">Find your perfect stay</h2>
          {hasAnyFilter ? (
            <button
              onClick={reset}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Clear all
            </button>
          ) : (
            <div className="w-14" />
          )}
        </div>

        <div className="p-6 space-y-6">

          {/* ── Location ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              Where in Liberia?
            </label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="City, area or neighbourhood"
                className="w-full pl-11 pr-4 py-3 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            {/* Quick-pick city chips */}
            <div className="flex flex-wrap gap-2">
              {LIBERIA_LOCATIONS.map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => setLocation(location === city ? '' : city)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    location === city
                      ? 'bg-primary text-white border-primary'
                      : 'border-border hover:border-primary hover:text-primary',
                  )}
                >
                  {city}
                </button>
              ))}
            </div>
          </div>

          {/* ── Dates ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold flex items-center gap-2">
              <CalendarIcon className="w-4 h-4 text-primary" />
              When?
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Popover>
                <PopoverTrigger asChild>
                  <button className={cn(
                    'flex items-center gap-2 px-4 py-3 border rounded-xl text-sm text-left transition-colors hover:border-primary',
                    checkIn ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
                  )}>
                    <CalendarIcon className="w-4 h-4 flex-shrink-0" />
                    {checkIn ? format(checkIn, 'MMM d, yyyy') : 'Check-in'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={checkIn}
                    onSelect={setCheckIn}
                    disabled={(d) => d < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger asChild>
                  <button className={cn(
                    'flex items-center gap-2 px-4 py-3 border rounded-xl text-sm text-left transition-colors hover:border-primary',
                    checkOut ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
                  )}>
                    <CalendarIcon className="w-4 h-4 flex-shrink-0" />
                    {checkOut ? format(checkOut, 'MMM d, yyyy') : 'Check-out'}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={checkOut}
                    onSelect={setCheckOut}
                    disabled={(d) => d < (checkIn || new Date())}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* ── Property type — from backend ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-primary" />
              Property type
              {categoriesQuery.isLoading && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              {categories.map(({ id, name, icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedType(selectedType === id ? '' : id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 rounded-xl border text-sm font-medium transition-all',
                    selectedType === id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>{icon}</span>
                  {name}
                </button>
              ))}
            </div>
          </div>

          {/* ── Budget ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold">Budget (USD / night)</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Min"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Max"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  className="w-full pl-7 pr-3 py-2.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
            </div>
          </div>

          {/* ── Guests ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Guests
            </label>
            <div className="border border-border rounded-xl px-4 divide-y divide-border">
              <Counter label="Adults"   sub="Ages 13+"      value={guests.adults}   min={1} onChange={(n) => setGuests({ ...guests, adults: n })} />
              <Counter label="Children" sub="Ages 2–12"     value={guests.children}         onChange={(n) => setGuests({ ...guests, children: n })} />
              <Counter label="Infants"  sub="Under 2"       value={guests.infants}          onChange={(n) => setGuests({ ...guests, infants: n })} />
              <Counter label="Pets"     sub="Bringing a pet?" value={guests.pets}            onChange={(n) => setGuests({ ...guests, pets: n })} />
            </div>
          </div>

          {/* ── Search button ── */}
          <Button
            onClick={handleSearch}
            className="w-full h-12 text-base font-semibold rounded-xl"
            size="lg"
          >
            <Search className="w-5 h-5 mr-2" />
            {searchLabel}
          </Button>

          {/* Active filter summary */}
          {(checkIn || checkOut || totalGuests > 1 || priceMin || priceMax) && (
            <p className="text-center text-xs text-muted-foreground">
              {[
                checkIn && checkOut && `${format(checkIn, 'MMM d')} – ${format(checkOut, 'MMM d')}`,
                totalGuests > 1 && `${totalGuests} guests`,
                (priceMin || priceMax) && [priceMin && `From $${priceMin}`, priceMax && `To $${priceMax}`].filter(Boolean).join(' '),
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
