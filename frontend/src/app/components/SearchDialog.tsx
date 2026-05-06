import React, { useState } from 'react';
import { X, Search, MapPin, Calendar as CalendarIcon, Users, Minus, Plus } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { Button } from './ui/button';
import { Calendar } from './ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { format } from 'date-fns';
import { useApp } from '../../hooks/useApp';
import { useNavigate } from 'react-router';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const navigate = useNavigate();
  const { setSearchFilters } = useApp();
  const [location, setLocation] = useState('');
  const [checkIn, setCheckIn] = useState<Date>();
  const [checkOut, setCheckOut] = useState<Date>();
  const [guests, setGuests] = useState({
    adults: 1,
    children: 0,
    infants: 0,
    pets: 0,
  });

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
    });
    navigate('/search');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-[95vw] sm:max-w-[900px] p-0 gap-0 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white z-10 border-b border-border p-6">
          <button
            onClick={onClose}
            className="absolute left-6 top-6 p-1 rounded-full hover:bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
          <h2 className="text-center font-semibold">Search for stays</h2>
        </div>

        <div className="p-6 space-y-6">
          {/* Location */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Where</label>
            <div className="relative">
              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search destinations"
                className="w-full pl-12 pr-4 py-4 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          {/* Dates */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">Check in</label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="w-full flex items-center gap-3 px-4 py-4 border border-border rounded-xl hover:border-primary transition-colors text-left">
                    <CalendarIcon className="w-5 h-5 text-muted-foreground" />
                    <span className={checkIn ? '' : 'text-muted-foreground'}>
                      {checkIn ? format(checkIn, 'MMM dd, yyyy') : 'Add date'}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={checkIn}
                    onSelect={setCheckIn}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold">Check out</label>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="w-full flex items-center gap-3 px-4 py-4 border border-border rounded-xl hover:border-primary transition-colors text-left">
                    <CalendarIcon className="w-5 h-5 text-muted-foreground" />
                    <span className={checkOut ? '' : 'text-muted-foreground'}>
                      {checkOut ? format(checkOut, 'MMM dd, yyyy') : 'Add date'}
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={checkOut}
                    onSelect={setCheckOut}
                    disabled={(date) => date < (checkIn || new Date())}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Guests */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Who</label>
            <Popover>
              <PopoverTrigger asChild>
                <button className="w-full flex items-center gap-3 px-4 py-4 border border-border rounded-xl hover:border-primary transition-colors text-left">
                  <Users className="w-5 h-5 text-muted-foreground" />
                  <span className={totalGuests > 0 ? '' : 'text-muted-foreground'}>
                    {totalGuests > 0 ? `${totalGuests} guest${totalGuests > 1 ? 's' : ''}` : 'Add guests'}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="start">
                <div className="space-y-4">
                  {/* Adults */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Adults</div>
                      <div className="text-sm text-muted-foreground">Ages 13+</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, adults: Math.max(1, guests.adults - 1) })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        disabled={guests.adults <= 1}
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center">{guests.adults}</span>
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, adults: guests.adults + 1 })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary flex items-center justify-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Children */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Children</div>
                      <div className="text-sm text-muted-foreground">Ages 2-12</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, children: Math.max(0, guests.children - 1) })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        disabled={guests.children === 0}
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center">{guests.children}</span>
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, children: guests.children + 1 })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary flex items-center justify-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Infants */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Infants</div>
                      <div className="text-sm text-muted-foreground">Under 2</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, infants: Math.max(0, guests.infants - 1) })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        disabled={guests.infants === 0}
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center">{guests.infants}</span>
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, infants: guests.infants + 1 })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary flex items-center justify-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Pets */}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">Pets</div>
                      <div className="text-sm text-muted-foreground">Service animals?</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, pets: Math.max(0, guests.pets - 1) })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                        disabled={guests.pets === 0}
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-8 text-center">{guests.pets}</span>
                      <button
                        type="button"
                        onClick={() => setGuests({ ...guests, pets: guests.pets + 1 })}
                        className="w-8 h-8 rounded-full border border-border hover:border-primary flex items-center justify-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Search Button */}
          <Button onClick={handleSearch} className="w-full" size="lg">
            <Search className="w-4 h-4 mr-2" />
            Search
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
