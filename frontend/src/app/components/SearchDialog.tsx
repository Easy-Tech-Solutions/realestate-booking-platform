import React, { useState } from 'react';
import {
  X, Search, MapPin, Calendar as CalendarIcon, Users,
  Minus, Plus, Home, Building2, TreePine, Landmark, SlidersHorizontal,
} from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { format } from 'date-fns';
import { useApp } from '../../hooks/useApp';
import { useNavigate } from 'react-router';
import { cn } from '../../core/utils';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

type StayType = 'stays' | 'hotels';

const LIBERIA_LOCATIONS = [
  'Monrovia', 'Paynesville', 'Gbarnga', 'Buchanan',
  'Kakata', 'Voinjama', 'Zwedru', 'Harper',
  'Robertsport', 'Tubmanburg',
];

const PROPERTY_TYPES = [
  { id: '',          label: 'Any',       icon: SlidersHorizontal },
  { id: 'apartment', label: 'Apartment', icon: Building2 },
  { id: 'house',     label: 'House',     icon: Home },
  { id: 'villa',     label: 'Villa',     icon: Landmark },
  { id: 'cabin',     label: 'Cabin',     icon: TreePine },
  { id: 'hotel',     label: 'Hotel',     icon: Building2 },
];

const BUDGET_PRESETS = [
  { label: 'Under L$500',   max: 500 },
  { label: 'L$500–1,500',   max: 1500 },
  { label: 'L$1,500–3,000', max: 3000 },
  { label: 'L$3,000+',      max: 99999 },
];

function Counter({
  label, sub, value, min = 0,
  onChange,
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

  const [stayType, setStayType]         = useState<StayType>('stays');
  const [location, setLocation]         = useState('');
  const [checkIn, setCheckIn]           = useState<Date>();
  const [checkOut, setCheckOut]         = useState<Date>();
  const [propertyType, setPropertyType] = useState('');
  const [budgetMax, setBudgetMax]       = useState<number | null>(null);
  const [guests, setGuests] = useState({ adults: 1, children: 0, infants: 0, pets: 0 });

  const totalGuests = guests.adults + guests.children;

  const handleSearch = () => {
    setSearchFilters({
      location,
      checkIn,
      checkOut,
      adults: guests.adults,
      children: guests.children,
      infants: guests.infants,
      pets: guests.pets,
      guests: totalGuests,
      ...(propertyType ? { propertyType: [propertyType as any] } : {}),
      ...(budgetMax ? { priceMax: budgetMax } : {}),
    });
    navigate('/search');
    onClose();
  };

  const reset = () => {
    setLocation('');
    setCheckIn(undefined);
    setCheckOut(undefined);
    setPropertyType('');
    setBudgetMax(null);
    setGuests({ adults: 1, children: 0, infants: 0, pets: 0 });
  };

  const hasAnyFilter = location || checkIn || checkOut || propertyType || budgetMax ||
    guests.children > 0 || guests.adults > 1;

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
            <div className="w-10" />
          )}
        </div>

        <div className="p-6 space-y-6">

          {/* ── Stay type tabs ── */}
          <div className="flex gap-1 p-1 bg-muted rounded-xl">
            {(['stays', 'hotels'] as StayType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setStayType(t)}
                className={cn(
                  'flex-1 py-2 rounded-lg text-sm font-semibold capitalize transition-all',
                  stayType === t
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'stays' ? '🏠 Stays' : '🏨 Hotels'}
              </button>
            ))}
          </div>

          {/* ── Location ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" /> Where in Liberia?
            </label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="City, area or neighbourhood"
                className="w-full pl-11 pr-4 py-3 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            {/* Quick-pick chips */}
            <div className="flex flex-wrap gap-2">
              {LIBERIA_LOCATIONS.map((city) => (
                <button
                  key={city}
                  type="button"
                  onClick={() => setLocation(city)}
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
              <CalendarIcon className="w-4 h-4 text-primary" /> When?
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

          {/* ── Property type ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold flex items-center gap-2">
              <Home className="w-4 h-4 text-primary" /> Property type
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {PROPERTY_TYPES.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPropertyType(id)}
                  className={cn(
                    'flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-xs font-medium transition-all',
                    propertyType === id
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Budget ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold">Budget (LRD / night)</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BUDGET_PRESETS.map(({ label, max }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setBudgetMax(budgetMax === max ? null : max)}
                  className={cn(
                    'py-2.5 px-3 rounded-xl border text-xs font-medium transition-all',
                    budgetMax === max
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-border hover:border-primary/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Guests ── */}
          <div className="space-y-3">
            <label className="text-sm font-semibold flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Guests
            </label>
            <div className="border border-border rounded-xl px-4 divide-y divide-border">
              <Counter label="Adults"   sub="Ages 13+"  value={guests.adults}   min={1} onChange={(n) => setGuests({ ...guests, adults: n })} />
              <Counter label="Children" sub="Ages 2–12" value={guests.children}         onChange={(n) => setGuests({ ...guests, children: n })} />
              <Counter label="Infants"  sub="Under 2"   value={guests.infants}          onChange={(n) => setGuests({ ...guests, infants: n })} />
              <Counter label="Pets"     sub="Bringing a pet?" value={guests.pets}        onChange={(n) => setGuests({ ...guests, pets: n })} />
            </div>
          </div>

          {/* ── Search button ── */}
          <Button onClick={handleSearch} className="w-full h-12 text-base font-semibold rounded-xl" size="lg">
            <Search className="w-5 h-5 mr-2" />
            Search{location ? ` in ${location}` : ' properties'}
          </Button>

          {/* Summary line */}
          {(checkIn || checkOut || totalGuests > 1) && (
            <p className="text-center text-xs text-muted-foreground">
              {[
                checkIn && checkOut && `${format(checkIn, 'MMM d')} – ${format(checkOut, 'MMM d')}`,
                totalGuests > 1 && `${totalGuests} guests`,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
