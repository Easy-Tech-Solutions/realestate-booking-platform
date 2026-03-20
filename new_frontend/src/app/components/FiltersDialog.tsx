import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Checkbox } from './ui/checkbox';
import { Slider } from './ui/slider';
import { AMENITIES, PROPERTY_TYPES } from '../../core/constants';
import { formatCurrency } from '../../core/utils';

interface FiltersDialogProps {
  open: boolean;
  onClose: () => void;
}

export function FiltersDialog({ open, onClose }: FiltersDialogProps) {
  const [priceRange, setPriceRange] = useState([50, 1000]);
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

  const togglePropertyType = (type: string) => {
    setSelectedPropertyTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities(prev =>
      prev.includes(amenity) ? prev.filter(a => a !== amenity) : [...prev, amenity]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[780px] max-h-[90vh] overflow-y-auto p-0 gap-0">
        <div className="sticky top-0 bg-white z-10 border-b border-border px-6 py-4">
          <button
            onClick={onClose}
            className="absolute left-6 top-4 p-1 rounded-full hover:bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-center font-semibold">Filters</h2>
        </div>

        <div className="p-6 space-y-8">
          {/* Price Range */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Price range</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Nightly prices before fees and taxes
            </p>
            <Slider
              value={priceRange}
              onValueChange={setPriceRange}
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
              <div>
                <label className="text-sm font-semibold mb-3 block">Bedrooms</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBedrooms(null)}
                    className={`px-4 py-2 border-2 rounded-xl ${
                      bedrooms === null ? 'border-primary bg-secondary/30' : 'border-border'
                    }`}
                  >
                    Any
                  </button>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                    <button
                      key={num}
                      onClick={() => setBedrooms(num)}
                      className={`px-4 py-2 border-2 rounded-xl ${
                        bedrooms === num ? 'border-primary bg-secondary/30' : 'border-border'
                      }`}
                    >
                      {num}{num === 8 ? '+' : ''}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold mb-3 block">Beds</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBeds(null)}
                    className={`px-4 py-2 border-2 rounded-xl ${
                      beds === null ? 'border-primary bg-secondary/30' : 'border-border'
                    }`}
                  >
                    Any
                  </button>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                    <button
                      key={num}
                      onClick={() => setBeds(num)}
                      className={`px-4 py-2 border-2 rounded-xl ${
                        beds === num ? 'border-primary bg-secondary/30' : 'border-border'
                      }`}
                    >
                      {num}{num === 8 ? '+' : ''}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold mb-3 block">Bathrooms</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setBathrooms(null)}
                    className={`px-4 py-2 border-2 rounded-xl ${
                      bathrooms === null ? 'border-primary bg-secondary/30' : 'border-border'
                    }`}
                  >
                    Any
                  </button>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
                    <button
                      key={num}
                      onClick={() => setBathrooms(num)}
                      className={`px-4 py-2 border-2 rounded-xl ${
                        bathrooms === num ? 'border-primary bg-secondary/30' : 'border-border'
                      }`}
                    >
                      {num}{num === 8 ? '+' : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Amenities */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Amenities</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {AMENITIES.slice(0, 12).map((amenity) => (
                <label
                  key={amenity.id}
                  className="flex items-center gap-3 cursor-pointer"
                >
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
                <Checkbox
                  checked={instantBook}
                  onCheckedChange={setInstantBook}
                />
                <div>
                  <p className="font-semibold">Instant Book</p>
                  <p className="text-sm text-muted-foreground">
                    Listings you can book without waiting for Host approval
                  </p>
                </div>
              </label>
              
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={superhost}
                  onCheckedChange={setSuperhost}
                />
                <div>
                  <p className="font-semibold">Superhost</p>
                  <p className="text-sm text-muted-foreground">
                    Stay with recognized Hosts
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-border px-6 py-4 flex items-center justify-between">
          <Button variant="ghost" onClick={handleClearAll}>
            Clear all
          </Button>
          <Button onClick={onClose}>
            Show stays
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
