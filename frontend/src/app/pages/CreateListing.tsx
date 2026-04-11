import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { Check, ChevronLeft, ChevronRight, Home, MapPin, Image, DollarSign, FileText, Settings } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { cn } from '../../core/utils';
import { PROPERTY_TYPES, AMENITIES } from '../../core/constants';
import { toast } from 'sonner';

const STEPS = [
  { id: 1, label: 'Type', icon: Home },
  { id: 2, label: 'Location', icon: MapPin },
  { id: 3, label: 'Details', icon: Settings },
  { id: 4, label: 'Amenities', icon: Check },
  { id: 5, label: 'Photos', icon: Image },
  { id: 6, label: 'Description', icon: FileText },
  { id: 7, label: 'Pricing', icon: DollarSign },
];

export function CreateListing() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    propertyType: '',
    address: '', city: '', state: '', country: '', zipCode: '',
    bedrooms: 1, beds: 1, bathrooms: 1, guests: 2,
    amenities: [] as string[],
    images: [] as string[],
    previewUrls: [] as string[],
    title: '', description: '',
    price: '', cleaningFee: '',
    checkIn: '15:00', checkOut: '11:00',
    minNights: 1, maxNights: 30,
    cancellationPolicy: 'flexible',
  });

  const update = (key: string, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const toggleAmenity = (id: string) => {
    setForm(prev => ({
      ...prev,
      amenities: prev.amenities.includes(id)
        ? prev.amenities.filter(a => a !== id)
        : [...prev.amenities, id],
    }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const urls = files.map(f => URL.createObjectURL(f));
    setForm(prev => ({
      ...prev,
      previewUrls: [...prev.previewUrls, ...urls].slice(0, 10),
    }));
  };

  const removeImage = (index: number) => {
    setForm(prev => ({
      ...prev,
      previewUrls: prev.previewUrls.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = () => {
    toast.success('Listing created successfully!');
    navigate('/host');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Progress Bar */}
      <div className="sticky top-0 z-40 bg-white border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-4">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => navigate('/host')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ChevronLeft className="w-4 h-4" /> Exit
            </button>
            <span className="text-sm font-medium">Step {step} of {STEPS.length}</span>
            <div className="w-16" />
          </div>
          <div className="flex gap-1">
            {STEPS.map(s => (
              <div key={s.id} className={cn('h-1 flex-1 rounded-full transition-colors', s.id <= step ? 'bg-primary' : 'bg-muted')} />
            ))}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12 max-w-2xl">
        {/* Step 1: Property Type */}
        {step === 1 && (
          <div>
            <h1 className="text-3xl font-semibold mb-2">What type of place will you host?</h1>
            <p className="text-muted-foreground mb-8">Choose the option that best describes your property.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PROPERTY_TYPES.map(type => (
                <button
                  key={type.id}
                  onClick={() => update('propertyType', type.id)}
                  className={cn(
                    'p-4 border-2 rounded-xl text-left transition-all hover:border-primary',
                    form.propertyType === type.id ? 'border-primary bg-primary/5' : 'border-border'
                  )}
                >
                  <p className="font-medium">{type.name}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Location */}
        {step === 2 && (
          <div>
            <h1 className="text-3xl font-semibold mb-2">Where's your place located?</h1>
            <p className="text-muted-foreground mb-8">Your address is only shared with guests after they book.</p>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Street address</Label>
                <Input placeholder="123 Main St" value={form.address} onChange={e => update('address', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>City</Label>
                  <Input placeholder="City" value={form.city} onChange={e => update('city', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>State / Province</Label>
                  <Input placeholder="State" value={form.state} onChange={e => update('state', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Input placeholder="Country" value={form.country} onChange={e => update('country', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>ZIP / Postal code</Label>
                  <Input placeholder="00000" value={form.zipCode} onChange={e => update('zipCode', e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Details */}
        {step === 3 && (
          <div>
            <h1 className="text-3xl font-semibold mb-2">Share some basics about your place</h1>
            <p className="text-muted-foreground mb-8">You can always change these later.</p>
            <div className="space-y-6">
              {[
                { label: 'Guests', key: 'guests' },
                { label: 'Bedrooms', key: 'bedrooms' },
                { label: 'Beds', key: 'beds' },
                { label: 'Bathrooms', key: 'bathrooms' },
              ].map(({ label, key }) => (
                <div key={key} className="flex items-center justify-between py-4 border-b border-border">
                  <span className="font-medium">{label}</span>
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => update(key, Math.max(1, (form as any)[key] - 1))}
                      className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors"
                    >−</button>
                    <span className="w-6 text-center font-medium">{(form as any)[key]}</span>
                    <button
                      onClick={() => update(key, (form as any)[key] + 1)}
                      className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:border-foreground transition-colors"
                    >+</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Amenities */}
        {step === 4 && (
          <div>
            <h1 className="text-3xl font-semibold mb-2">Tell guests what your place has to offer</h1>
            <p className="text-muted-foreground mb-8">You can add more amenities after you publish your listing.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {AMENITIES.map(amenity => (
                <button
                  key={amenity.id}
                  onClick={() => toggleAmenity(amenity.id)}
                  className={cn(
                    'p-4 border-2 rounded-xl text-left transition-all hover:border-primary',
                    form.amenities.includes(amenity.id) ? 'border-primary bg-primary/5' : 'border-border'
                  )}
                >
                  <p className="font-medium text-sm">{amenity.name}</p>
                  <p className="text-xs text-muted-foreground">{amenity.category}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Photos */}
        {step === 5 && (
          <div>
            <h1 className="text-3xl font-semibold mb-2">Add some photos of your place</h1>
            <p className="text-muted-foreground mb-8">You'll need at least 5 photos to get started. You can always add more later.</p>

            <label
              htmlFor="photo-upload"
              className="border-2 border-dashed border-border rounded-xl p-12 text-center hover:border-primary transition-colors cursor-pointer flex flex-col items-center"
            >
              <Image className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="font-medium mb-1">Drag your photos here or click to upload</p>
              <p className="text-sm text-muted-foreground mb-4">Choose at least 5 photos · JPG, PNG, WEBP</p>
              <span className="px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted">Upload from your device</span>
              <input
                id="photo-upload"
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </label>

            {form.previewUrls.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-muted-foreground mb-2">{form.previewUrls.length} photo{form.previewUrls.length !== 1 ? 's' : ''} selected</p>
                <div className="grid grid-cols-3 gap-2">
                  {form.previewUrls.map((src, i) => (
                    <div key={i} className="relative group">
                      <img src={src} alt="" className="w-full h-24 object-cover rounded-lg" />
                      <button
                        onClick={() => removeImage(i)}
                        className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center text-white text-xs font-medium"
                      >
                        Remove
                      </button>
                      {i === 0 && (
                        <span className="absolute top-1 left-1 bg-primary text-white text-xs px-1.5 py-0.5 rounded">Cover</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 6: Description */}
        {step === 6 && (
          <div>
            <h1 className="text-3xl font-semibold mb-2">Now, let's give your place a title</h1>
            <p className="text-muted-foreground mb-8">Short titles work best. Have fun with it — you can always change it later.</p>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Listing title</Label>
                <Input
                  placeholder="e.g. Cozy beachfront villa with stunning views"
                  value={form.title}
                  onChange={e => update('title', e.target.value)}
                  maxLength={50}
                />
                <p className="text-xs text-muted-foreground text-right">{form.title.length}/50</p>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Tell guests what makes your place special..."
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  rows={6}
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground text-right">{form.description.length}/500</p>
              </div>
            </div>
          </div>
        )}

        {/* Step 7: Pricing */}
        {step === 7 && (
          <div>
            <h1 className="text-3xl font-semibold mb-2">Now, set your price</h1>
            <p className="text-muted-foreground mb-8">You can change it anytime.</p>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label>Base price per night (USD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input className="pl-7" placeholder="0" type="number" value={form.price} onChange={e => update('price', e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cleaning fee (USD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input className="pl-7" placeholder="0" type="number" value={form.cleaningFee} onChange={e => update('cleaningFee', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Minimum nights</Label>
                  <Input type="number" value={form.minNights} onChange={e => update('minNights', Number(e.target.value))} min={1} />
                </div>
                <div className="space-y-2">
                  <Label>Maximum nights</Label>
                  <Input type="number" value={form.maxNights} onChange={e => update('maxNights', Number(e.target.value))} min={1} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Check-in time</Label>
                  <Input type="time" value={form.checkIn} onChange={e => update('checkIn', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Check-out time</Label>
                  <Input type="time" value={form.checkOut} onChange={e => update('checkOut', e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Cancellation policy</Label>
                <div className="grid grid-cols-3 gap-3">
                  {['flexible', 'moderate', 'strict'].map(policy => (
                    <button
                      key={policy}
                      onClick={() => update('cancellationPolicy', policy)}
                      className={cn(
                        'p-3 border-2 rounded-xl text-sm font-medium capitalize transition-all',
                        form.cancellationPolicy === policy ? 'border-primary bg-primary/5' : 'border-border hover:border-primary'
                      )}
                    >
                      {policy}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-12">
          <Button variant="outline" onClick={() => step > 1 ? setStep(s => s - 1) : navigate('/host')} className="flex items-center gap-2">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          {step < STEPS.length ? (
            <Button onClick={() => setStep(s => s + 1)} className="flex items-center gap-2">
              Next <ChevronRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} className="flex items-center gap-2">
              Publish listing <Check className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
