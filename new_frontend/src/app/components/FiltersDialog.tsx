import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Checkbox } from './ui/checkbox';
import { Slider } from './ui/slider';
import { AMENITIES, PROPERTY_TYPES } from '../../core/constants';
import { formatCurrency } from '../../core/utils';
import { mockProperties } from '../../services/mock-data';

export interface ActiveFilters {
  priceRange: [number, number];
  propertyTypes: string[];
  amenities: string[];
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  instantBook: boolean;
  superhost: boolean;
}

interface FiltersDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (filters: ActiveFilters) => void;
}

// Build a simple price histogram from mock data
const BUCKETS = 20;
const prices = mockProperties.map(p => p.price);
const minPrice = Math.min(...prices);
const maxPrice = Math.max(...prices);
const bucketSize = (maxPrice - minPrice) / BUCKETS;
const histogram = Array.from({ length: BUCKETS }, (_, i) => {
  const lo = minPrice + i * bucketSize;
  const hi = lo + bucketSize;
  return prices.filter(p => p >= lo && p < hi).length;
});
const histMax = Math.max(...histogram);

export function FiltersDialog({ open, onClose, onApply }: FiltersDialogProps) {
  const [priceRange, setPriceRange] = useState<[number, number]>([50, 1000]);
  const [selectedPropertyTypes, setSelectedPropertyTypes] = useState<string[]>([]);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [bedrooms, setBedrooms] = useState<number | null>(null);
  const [beds, setBeds] = useState<number | null>(null);
  const [bathrooms, setBathrooms] = useState<number | null>(null);
  const [instantBook, setInstantBook] = useState(false);
  const [superhost, setSuperhost] = useState(false);

  const handleClearAll = () => {
    setPriceRange([50, 1000]);
    setSelectedPropertyTypes([]);
    setSelectedAmenities([]);
    setBedrooms(null);
    setBeds(null);
    setBathrooms(null);
    setInstantBook(false);
    setSuperhost(false);
  };

  const togglePropertyType = (type: string) =>
    setSelectedPropertyTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );

  const toggleAmenity = (amenity: string) =>
    setSelectedAmenities(prev =>
      prev.includes(amenity) ? prev.filter(a => a !== amenity) : [...prev, amenity]
    );

  const handleApply = () => {
    onApply({ priceRange, propertyTypes: selectedPropertyTypes, amenities: selectedAmenities, bedrooms, beds, bathrooms, instantBook, superhost });
    onClose();
  };

  const activeCount = [
    priceRange[0] !== 50 || priceRange[1] !== 1000,
    selectedPropertyTypes.length > 0,
    selectedAmenities.length > 0,
    bedrooms !== null,
    beds !== null,
    bathrooms !== null,
    instantBook,
    superhost,
  ].filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[780px] max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="sticky top-0 bg-white z-10 border-b border-border px-6 py-4">
          <button onClick={onClose} className="absolute left-6 top-4 p-1 rounded-full hover:bg-muted">
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-center font-semibold">
            Filters{activeCount > 0 && ` (${activeCount})`}
          </h2>
        </div>

        <div className="p-6 space-y-8">
          {/* Price Range with histogram */}
          <div>
            <h3 className="text-lg font-semibold mb-1">Price range</h3>
            <p className="text-sm text-muted-foreground mb-4">Nightly prices before fees and taxes</p>

            {/* Histogram bars */}
            <div className="flex items-end gap-0.5 h-16 mb-3">
              {histogram.map((count, i) => {
                const lo = minPrice + i * bucketSize;
                const hi = lo + bucketSize;
                const inRange = hi >= priceRange[0] && lo <= priceRange[1];
                return (
                  <div
                    key={i}
                    className="flex-1 rounded-sm transition-colors"
                    style={{
                      height: `${(count / histMax) * 100}%`,
                      backgroundColor: inRange ? '#004406' : '#e5e7eb',
                    }}
                  />
                );
              })}
            </div>

            <Slider
              value={priceRange}
              onValueChange={v => setPriceRange(v as [number, number])}
              min={0}
              max={2000}
              step={10}
              className="mb-4"
            />
            <div className="grid grid-cols-2 gap-4">
              <div className="border border-border rounded-xl p-3">
                <label className="text-xs text-muted-foreground block mb-1">Minimum</label>
                <p className="font-semibold">{formatCurrency(priceRange[0])}</p>
              </div>
              <div className="border border-border rounded-xl p-3">
                <label className="text-xs text-muted-foreground block mb-1">Maximum</label>
                <p className="font-semibold">{formatCurrency(priceRange[1])}</p>
              </div>
            </div>
          </div>

          <Separator />

          {/* Property Type */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Property type</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PROPERTY_TYPES.slice(0, 6).map((type) => (
                <button
                  key={type.id}
                  onClick={() => togglePropertyType(type.id)}
                  className={`p-4 border-2 rounded-xl text-left transition-colors ${
                    selectedPropertyTypes.includes(type.id)
                      ? 'border-primary bg-secondary/30'
                      : 'border-border hover:border-primary'
                  }`}
                >
                  <p className="font-semibold capitalize">{type.name}</p>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Rooms and beds */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Rooms and beds</h3>
            <div className="space-y-4">
              {[
                { label: 'Bedrooms', value: bedrooms, setter: setBedrooms },
                { label: 'Beds', value: beds, setter: setBeds },
                { label: 'Bathrooms', value: bathrooms, setter: setBathrooms },
              ].map(({ label, value, setter }) => (
                <div key={label}>
                  <label className="text-sm font-semibold mb-3 block">{label}</label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setter(null)}
                      className={`px-4 py-2 border-2 rounded-xl ${value === null ? 'border-primary bg-secondary/30' : 'border-border'}`}
                    >
                      Any
                    </button>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                      <button
                        key={num}
                        onClick={() => setter(num)}
                        className={`px-4 py-2 border-2 rounded-xl ${value === num ? 'border-primary bg-secondary/30' : 'border-border'}`}
                      >
                        {num}{num === 8 ? '+' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Amenities */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Amenities</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {AMENITIES.slice(0, 12).map((amenity) => (
                <label key={amenity.id} className="flex items-center gap-3 cursor-pointer">
                  <Checkbox
                    checked={selectedAmenities.includes(amenity.id)}
                    onCheckedChange={() => toggleAmenity(amenity.id)}
                  />
                  <span className="text-sm">{amenity.name}</span>
                </label>
              ))}
            </div>
          </div>

          <Separator />

          {/* Booking options */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Booking options</h3>
            <div className="space-y-4">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox checked={instantBook} onCheckedChange={v => setInstantBook(!!v)} />
                <div>
                  <p className="font-semibold">Instant Book</p>
                  <p className="text-sm text-muted-foreground">Listings you can book without waiting for Host approval</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox checked={superhost} onCheckedChange={v => setSuperhost(!!v)} />
                <div>
                  <p className="font-semibold">Superhost</p>
                  <p className="text-sm text-muted-foreground">Stay with recognized Hosts</p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-border px-6 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={handleClearAll}>Clear all</Button>
          <Button onClick={handleApply}>Show stays</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
