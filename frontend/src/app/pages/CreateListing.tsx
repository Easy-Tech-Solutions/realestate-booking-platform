import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  ChevronDown,
  Minus,
  Plus,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Checkbox } from '../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { cn } from '../../core/utils';
import { AMENITIES, PROPERTY_CATEGORIES } from '../../core/constants';
import { propertiesAPI } from '../../services/api.service';
import { toast } from 'sonner';

type WizardStep =
  | 'welcome'
  | 'step1_intro'
  | 'property_type'
  | 'privacy_type'
  | 'location'
  | 'basics'
  | 'amenities'
  | 'photos'
  | 'title'
  | 'highlights'
  | 'description'
  | 'step3_intro'
  | 'booking_settings'
  | 'discounts'
  | 'weekday_price'
  | 'weekend_price'
  | 'safety'
  | 'final_details';

const STEPS: WizardStep[] = [
  'welcome',
  'step1_intro',
  'property_type',
  'privacy_type',
  'location',
  'basics',
  'amenities',
  'photos',
  'title',
  'highlights',
  'description',
  'step3_intro',
  'booking_settings',
  'discounts',
  'weekday_price',
  'weekend_price',
  'safety',
  'final_details',
];

const HIGHLIGHTS = ['Peaceful', 'Unique', 'Family-friendly', 'Stylish', 'Central', 'Spacious'];
const COUNTRIES = ['Rwanda', 'Kenya', 'Uganda', 'Tanzania', 'Ghana', 'Nigeria'];

export function CreateListing() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState({
    propertyType: 'homes',
    privacyType: 'entire_place',

    country: 'Rwanda',
    address1: '',
    address2: '',
    city: '',
    state: '',
    postalCode: '',

    guests: 4,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,

    amenities: ['wifi', 'tv', 'kitchen', 'washer'] as string[],

    images: [] as File[],
    imagePreviews: [] as string[],

    title: '',
    description: '',
    highlights: [] as string[],

    bookingMode: 'approve_first_3',

    newListingPromo: true,
    lastMinuteDiscountEnabled: true,
    lastMinuteDiscountPercent: 7,
    weeklyDiscountEnabled: true,
    weeklyDiscountPercent: 10,
    monthlyDiscountEnabled: true,
    monthlyDiscountPercent: 15,

    weekdayBasePrice: 42,
    weekendPremiumPercent: 1,

    exteriorCamera: false,
    noiseMonitor: false,
    weaponsOnProperty: false,
  });

  const currentStep = STEPS[stepIndex];

  const categoriesQuery = useQuery({
    queryKey: ['property-categories', 'create-listing'],
    queryFn: () => propertiesAPI.listCategories(),
  });
  const listingCategories = (categoriesQuery.data || []).length
    ? (categoriesQuery.data || []).map((category) => ({ id: category.slug, name: category.name }))
    : PROPERTY_CATEGORIES.map((category) => ({ id: category.id, name: category.name }));

  const update = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const updateCount = (field: 'guests' | 'bedrooms' | 'beds' | 'bathrooms', delta: number) => {
    update({ [field]: Math.max(1, form[field] + delta) } as Partial<typeof form>);
  };

  const toggleAmenity = (id: string) => {
    update({
      amenities: form.amenities.includes(id)
        ? form.amenities.filter((a) => a !== id)
        : [...form.amenities, id],
    });
  };

  const toggleHighlight = (label: string) => {
    const exists = form.highlights.includes(label);
    if (!exists && form.highlights.length >= 2) return;
    update({
      highlights: exists
        ? form.highlights.filter((h) => h !== label)
        : [...form.highlights, label],
    });
  };

  const onPhotosSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const nextImages = [...form.images, ...files].slice(0, 20);
    const nextPreviews = nextImages.map((f) => URL.createObjectURL(f));
    update({ images: nextImages, imagePreviews: nextPreviews });
  };

  const removePhoto = (index: number) => {
    const nextImages = form.images.filter((_, i) => i !== index);
    const nextPreviews = form.imagePreviews.filter((_, i) => i !== index);
    update({ images: nextImages, imagePreviews: nextPreviews });
  };

  const composedAddress = useMemo(() => {
    return [
      form.address1,
      form.address2,
      form.city,
      form.state,
      form.country,
      form.postalCode,
    ]
      .filter(Boolean)
      .join(', ');
  }, [form]);

  const sectionProgress = useMemo(() => {
    const s1Start = STEPS.indexOf('step1_intro');
    const s1End = STEPS.indexOf('description');
    const s2Start = STEPS.indexOf('step3_intro');
    const s2End = STEPS.indexOf('final_details');

    const ratio = (start: number, end: number) => {
      if (stepIndex < start) return 0;
      if (stepIndex > end) return 1;
      return (stepIndex - start + 1) / (end - start + 1);
    };

    return {
      step1: ratio(s1Start, s1End),
      step2: ratio(s2Start, s2End),
      step3: stepIndex >= s2Start ? Math.min(1, (stepIndex - s2Start + 1) / (s2End - s2Start + 1)) : 0,
    };
  }, [stepIndex]);

  const canContinue = useMemo(() => {
    switch (currentStep) {
      case 'property_type':
        return Boolean(form.propertyType);
      case 'privacy_type':
        return Boolean(form.privacyType);
      case 'location':
        return Boolean(form.address1 && form.city && form.country);
      case 'photos':
        return form.images.length >= 5;
      case 'title':
        return form.title.trim().length > 0;
      case 'description':
        return form.description.trim().length > 0;
      case 'final_details':
        return Boolean(form.address1 && form.city && form.country);
      default:
        return true;
    }
  }, [currentStep, form]);

  const next = () => {
    if (!canContinue) return;
    if (stepIndex < STEPS.length - 1) setStepIndex((s) => s + 1);
  };

  const back = () => {
    if (stepIndex === 0) {
      navigate('/host');
      return;
    }
    setStepIndex((s) => Math.max(0, s - 1));
  };

  const publish = async () => {
    if (!canContinue || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const payload = new FormData();
      payload.append('title', form.title);
      payload.append('description', form.description);
      // The backend doesn't have 'apartment' as a valid category slug.
      // We map it to 'homes' here as a temporary fix.
      // The correct solution is to add 'apartment' to the PropertyCategory table in the Django admin.
      const propertyTypeToSend = form.propertyType === 'apartment' ? 'homes' : form.propertyType;
      payload.append('property_type', propertyTypeToSend);
      payload.append('privacy_type', form.privacyType);
      payload.append('address', composedAddress);
      payload.append('price', String(form.weekdayBasePrice));
      payload.append('bedrooms', String(form.bedrooms));
      payload.append('beds', String(form.beds));
      payload.append('bathrooms', String(form.bathrooms));
      payload.append('max_guests', String(form.guests));
      payload.append('amenities', JSON.stringify(form.amenities));
      payload.append('highlights', JSON.stringify(form.highlights));
      payload.append('booking_mode', form.bookingMode.startsWith('approve') ? 'approve_first' : 'instant');
      payload.append('weekend_premium_percent', String(form.weekendPremiumPercent));
      payload.append('new_listing_promo', String(form.newListingPromo));
      payload.append('last_minute_discount_enabled', String(form.lastMinuteDiscountEnabled));
      payload.append('last_minute_discount_percent', String(form.lastMinuteDiscountPercent));
      payload.append('weekly_discount_enabled', String(form.weeklyDiscountEnabled));
      payload.append('weekly_discount_percent', String(form.weeklyDiscountPercent));
      payload.append('monthly_discount_enabled', String(form.monthlyDiscountEnabled));
      payload.append('monthly_discount_percent', String(form.monthlyDiscountPercent));
      payload.append('exterior_camera', String(form.exteriorCamera));
      payload.append('noise_monitor', String(form.noiseMonitor));
      payload.append('weapons_on_property', String(form.weaponsOnProperty));
      payload.append('square_footage', '0');
      payload.append('is_available', 'true');

      if (form.images[0]) {
        payload.append('main_image', form.images[0]);
      }

      const created = await propertiesAPI.create(payload);

      if (form.images.length > 1) {
        const remaining = form.images.slice(1, 11);
        for (const [idx, file] of remaining.entries()) {
          await propertiesAPI.addGalleryImage(created.id, file, '', idx);
        }
      }

      toast.success('Listing created successfully');
      navigate('/host');
    } catch (error: any) {
      if (error?.status === 401) {
        toast.error('Your session has expired. Please log in again.');
      } else if (error?.status === 400 && error?.data && typeof error.data === 'object') {
        const firstEntry = Object.entries(error.data)[0] as [string, any] | undefined;
        if (firstEntry) {
          const [field, value] = firstEntry;
          const detail = Array.isArray(value) ? value[0] : String(value);
          toast.error(`${field}: ${detail}`);
        } else {
          toast.error('Invalid listing data. Please review all required fields.');
        }
      } else {
        toast.error(error?.message || 'Failed to create listing');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const guestPriceBeforeTaxes = Math.round(form.weekdayBasePrice * 1.14);
  const weekendPrice = Math.round(form.weekdayBasePrice * (1 + form.weekendPremiumPercent / 100));

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-8 py-6 flex items-center justify-between">
        <div className="text-2xl font-semibold tracking-tight">HomeKonet</div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">Questions?</Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/host')}>Save & exit</Button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 pb-10">
        {currentStep === 'welcome' && (
          <div className="grid lg:grid-cols-2 gap-10 items-center py-10">
            <div>
              <h1 className="text-6xl font-semibold leading-tight">It's easy to get started on HomeKonet</h1>
            </div>
            <div className="space-y-6">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <p className="text-3xl font-semibold">1</p>
                  <p className="text-3xl font-semibold">Tell us about your place</p>
                  <p className="text-muted-foreground text-2xl">Share basic info, like where it is and how many guests can stay.</p>
                </div>
              </div>
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <p className="text-3xl font-semibold">2</p>
                  <p className="text-3xl font-semibold">Make it stand out</p>
                  <p className="text-muted-foreground text-2xl">Add photos plus a title and description.</p>
                </div>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-3xl font-semibold">3</p>
                  <p className="text-3xl font-semibold">Finish up and publish</p>
                  <p className="text-muted-foreground text-2xl">Set booking settings, pricing, and publish.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 'step1_intro' && (
          <div className="grid lg:grid-cols-2 gap-10 items-center py-12">
            <div>
              <p className="text-2xl text-muted-foreground mb-2">Step 1</p>
              <h2 className="text-6xl font-semibold mb-4">Tell us about your place</h2>
              <p className="text-3xl text-muted-foreground">We'll ask what type of property you have and where guests can stay.</p>
            </div>
            <div className="rounded-3xl border p-10 text-center text-muted-foreground">Property setup</div>
          </div>
        )}

        {currentStep === 'property_type' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-8">Which of these best describes your place?</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {listingCategories.map((type) => (
                <button
                  key={type.id}
                  onClick={() => update({ propertyType: type.id })}
                  className={cn(
                    'border rounded-2xl p-6 text-left transition',
                    form.propertyType === type.id ? 'border-2 border-foreground' : 'hover:border-foreground'
                  )}
                >
                  <p className="text-2xl font-medium">{type.name}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'privacy_type' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-8">What type of place will guests have?</h2>
            <div className="space-y-4">
              {[
                { id: 'entire_place', title: 'An entire place', subtitle: 'Guests have the whole place to themselves.' },
                { id: 'private_room', title: 'A private room', subtitle: 'Guests have their own room and shared spaces.' },
                { id: 'shared_room', title: 'A shared room in a hostel', subtitle: 'Guests sleep in a shared room.' },
              ].map((option) => (
                <button
                  key={option.id}
                  onClick={() => update({ privacyType: option.id as 'entire_place' | 'private_room' | 'shared_room' })}
                  className={cn(
                    'w-full border rounded-2xl p-6 text-left transition',
                    form.privacyType === option.id ? 'border-2 border-foreground' : 'hover:border-foreground'
                  )}
                >
                  <p className="text-3xl font-medium mb-1">{option.title}</p>
                  <p className="text-muted-foreground text-2xl">{option.subtitle}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'location' && (
          <section className="max-w-3xl mx-auto py-8 space-y-6">
            <h2 className="text-6xl font-semibold">Where's your place located?</h2>
            <p className="text-2xl text-muted-foreground">We only share your address with guests after booking.</p>
            <div className="space-y-4">
              <div>
                <Label>Country / region</Label>
                <Select value={form.country} onValueChange={(v) => update({ country: v })}>
                  <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map((country) => (
                      <SelectItem key={country} value={country}>{country}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input placeholder="Street address" value={form.address1} onChange={(e) => update({ address1: e.target.value })} />
              <Input placeholder="Apt, floor, bldg (if applicable)" value={form.address2} onChange={(e) => update({ address2: e.target.value })} />
              <Input placeholder="City / town / village" value={form.city} onChange={(e) => update({ city: e.target.value })} />
              <Input placeholder="Province / state / territory" value={form.state} onChange={(e) => update({ state: e.target.value })} />
              <Input placeholder="Postal code" value={form.postalCode} onChange={(e) => update({ postalCode: e.target.value })} />
            </div>
          </section>
        )}

        {currentStep === 'basics' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Share some basics about your place</h2>
            <p className="text-2xl text-muted-foreground mb-8">You'll add more details later, like bed types.</p>
            <div className="space-y-2">
              {[
                { label: 'Guests', key: 'guests' as const },
                { label: 'Bedrooms', key: 'bedrooms' as const },
                { label: 'Beds', key: 'beds' as const },
                { label: 'Bathrooms', key: 'bathrooms' as const },
              ].map(({ label, key }) => (
                <div key={key} className="flex items-center justify-between py-5 border-b">
                  <p className="text-3xl">{label}</p>
                  <div className="flex items-center gap-5">
                    <button type="button" aria-label={`Decrease ${label}`} className="w-10 h-10 rounded-full border flex items-center justify-center" onClick={() => updateCount(key, -1)}>
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-3xl font-medium w-8 text-center">{form[key]}</span>
                    <button type="button" aria-label={`Increase ${label}`} className="w-10 h-10 rounded-full border flex items-center justify-center" onClick={() => updateCount(key, 1)}>
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'amenities' && (
          <section className="max-w-4xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Tell guests what your place has to offer</h2>
            <p className="text-2xl text-muted-foreground mb-8">You can add more amenities after publishing.</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {AMENITIES.map((amenity) => (
                <button
                  key={amenity.id}
                  onClick={() => toggleAmenity(amenity.id)}
                  className={cn(
                    'border rounded-2xl p-5 text-left transition',
                    form.amenities.includes(amenity.id) ? 'border-2 border-foreground' : 'hover:border-foreground'
                  )}
                >
                  <p className="text-2xl font-medium mb-1">{amenity.name}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'photos' && (
          <section className="max-w-4xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Add some photos of your apartment</h2>
            <p className="text-2xl text-muted-foreground mb-8">You'll need at least 5 photos to get started.</p>

            <label className="border-2 border-dashed rounded-2xl min-h-[340px] flex flex-col items-center justify-center cursor-pointer hover:border-foreground transition">
              <Camera className="w-14 h-14 mb-4 text-muted-foreground" />
              <p className="text-3xl font-medium mb-1">Drag and drop</p>
              <p className="text-muted-foreground text-2xl mb-4">or browse for photos</p>
              <span className="px-5 py-3 rounded-xl border font-medium">Browse</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={onPhotosSelected} />
            </label>

            <p className="text-sm text-muted-foreground mt-3">{form.images.length} selected</p>
            {form.imagePreviews.length > 0 && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {form.imagePreviews.map((preview, index) => (
                  <div key={index} className="relative group border rounded-xl overflow-hidden">
                    <img src={preview} alt={`Upload ${index + 1}`} className="w-full h-28 object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 text-white text-sm"
                      onClick={() => removePhoto(index)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentStep === 'title' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Now, let's give your apartment a title</h2>
            <p className="text-2xl text-muted-foreground mb-8">Short titles work best. You can always edit later.</p>
            <Textarea
              rows={6}
              maxLength={50}
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Enter listing title"
            />
            <p className="text-sm text-muted-foreground mt-2">{form.title.length}/50</p>
          </section>
        )}

        {currentStep === 'highlights' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Next, let's describe your apartment</h2>
            <p className="text-2xl text-muted-foreground mb-8">Choose up to 2 highlights.</p>
            <div className="flex flex-wrap gap-3">
              {HIGHLIGHTS.map((h) => (
                <button
                  key={h}
                  onClick={() => toggleHighlight(h)}
                  className={cn(
                    'px-5 py-3 rounded-full border text-2xl',
                    form.highlights.includes(h) ? 'border-foreground bg-muted' : 'hover:border-foreground'
                  )}
                >
                  {h}
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'description' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Create your description</h2>
            <p className="text-2xl text-muted-foreground mb-8">Share what makes your place special.</p>
            <Textarea
              rows={8}
              maxLength={500}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Describe your place"
            />
            <p className="text-sm text-muted-foreground mt-2">{form.description.length}/500</p>
          </section>
        )}

        {currentStep === 'step3_intro' && (
          <div className="grid lg:grid-cols-2 gap-10 items-center py-12">
            <div>
              <p className="text-2xl text-muted-foreground mb-2">Step 3</p>
              <h2 className="text-6xl font-semibold mb-4">Finish up and publish</h2>
              <p className="text-3xl text-muted-foreground">Choose booking settings, set up pricing, and publish your listing.</p>
            </div>
            <div className="rounded-3xl border p-10 text-center text-muted-foreground">Publishing setup</div>
          </div>
        )}

        {currentStep === 'booking_settings' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Pick your booking settings</h2>
            <p className="text-2xl text-muted-foreground mb-8">You can change this at any time.</p>
            <div className="space-y-4">
              {[
                {
                  id: 'approve_first_3',
                  title: 'Approve your first 3 bookings',
                  subtitle: 'Recommended for new hosts.',
                },
                {
                  id: 'instant_book',
                  title: 'Use Instant Book',
                  subtitle: 'Let guests book automatically.',
                },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => update({ bookingMode: opt.id })}
                  className={cn(
                    'w-full border rounded-2xl p-6 text-left',
                    form.bookingMode === opt.id ? 'border-2 border-foreground' : 'hover:border-foreground'
                  )}
                >
                  <p className="text-3xl font-medium">{opt.title}</p>
                  <p className="text-2xl text-muted-foreground">{opt.subtitle}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'discounts' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Add discounts</h2>
            <p className="text-2xl text-muted-foreground mb-8">Help your place stand out and get booked faster.</p>
            <div className="space-y-4">
              {[
                {
                  key: 'newListingPromo',
                  title: 'New listing promotion',
                  description: 'Offer 20% off your first 3 bookings',
                  value: true,
                },
                {
                  key: 'lastMinuteDiscountEnabled',
                  title: 'Last-minute discount',
                  description: 'For stays booked 14 days or less before arrival',
                  value: form.lastMinuteDiscountPercent,
                },
                {
                  key: 'weeklyDiscountEnabled',
                  title: 'Weekly discount',
                  description: 'For stays of 7 nights or more',
                  value: form.weeklyDiscountPercent,
                },
                {
                  key: 'monthlyDiscountEnabled',
                  title: 'Monthly discount',
                  description: 'For stays of 28 nights or more',
                  value: form.monthlyDiscountPercent,
                },
              ].map((item) => {
                const enabled = form[item.key as keyof typeof form] as boolean;
                return (
                  <div key={item.key} className="border rounded-2xl p-5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-12 rounded-xl border flex items-center justify-center text-3xl font-semibold">
                        {typeof item.value === 'number' ? `${item.value}%` : '20%'}
                      </div>
                      <div>
                        <p className="text-3xl font-medium">{item.title}</p>
                        <p className="text-2xl text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                    <Checkbox
                      checked={enabled}
                      onCheckedChange={(checked) => update({ [item.key]: Boolean(checked) } as Partial<typeof form>)}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {currentStep === 'weekday_price' && (
          <section className="max-w-3xl mx-auto py-8 text-center">
            <h2 className="text-6xl font-semibold mb-3">Now, set a weekday base price</h2>
            <p className="text-2xl text-muted-foreground mb-8">Tip: $42. You'll set a weekend price next.</p>
            <div className="text-[120px] font-semibold leading-none">${form.weekdayBasePrice}</div>
            <p className="text-3xl text-muted-foreground mt-3">Guest price before taxes ${guestPriceBeforeTaxes} <ChevronDown className="inline w-5 h-5" /></p>
            <div className="mt-8 flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => update({ weekdayBasePrice: Math.max(10, form.weekdayBasePrice - 1) })}>-</Button>
              <Button variant="outline" size="sm" onClick={() => update({ weekdayBasePrice: form.weekdayBasePrice + 1 })}>+</Button>
            </div>
          </section>
        )}

        {currentStep === 'weekend_price' && (
          <section className="max-w-3xl mx-auto py-8 text-center">
            <h2 className="text-6xl font-semibold mb-3">Set a weekend price</h2>
            <p className="text-2xl text-muted-foreground mb-8">Add a premium for Fridays and Saturdays.</p>
            <div className="text-[120px] font-semibold leading-none">${weekendPrice}</div>
            <p className="text-3xl text-muted-foreground mt-3">Guest price before taxes ${Math.round(weekendPrice * 1.14)} <ChevronDown className="inline w-5 h-5" /></p>
            <div className="max-w-xl mx-auto mt-10 text-left">
              <p className="text-3xl font-medium mb-2">Weekend premium</p>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  aria-label="Weekend premium percentage"
                  min={0}
                  max={99}
                  value={form.weekendPremiumPercent}
                  onChange={(e) => update({ weekendPremiumPercent: Number(e.target.value) })}
                  className="w-full"
                />
                <div className="w-20 h-14 border rounded-2xl flex items-center justify-center text-4xl font-semibold">
                  {form.weekendPremiumPercent}%
                </div>
              </div>
            </div>
          </section>
        )}

        {currentStep === 'safety' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-6xl font-semibold mb-3">Share safety details</h2>
            <p className="text-2xl text-muted-foreground mb-8">Does your place have any of these?</p>
            <div className="space-y-6 max-w-2xl">
              {[
                { key: 'exteriorCamera', label: 'Exterior security camera present' },
                { key: 'noiseMonitor', label: 'Noise decibel monitor present' },
                { key: 'weaponsOnProperty', label: 'Weapon(s) on the property' },
              ].map((s) => (
                <div key={s.key} className="flex items-center justify-between">
                  <p className="text-3xl">{s.label}</p>
                  <Checkbox
                    checked={form[s.key as keyof typeof form] as boolean}
                    onCheckedChange={(checked) => update({ [s.key]: Boolean(checked) } as Partial<typeof form>)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'final_details' && (
          <section className="max-w-3xl mx-auto py-8 space-y-6">
            <h2 className="text-6xl font-semibold">Provide a few final details</h2>
            <p className="text-2xl text-muted-foreground">This is required to help prevent fraud.</p>

            <div className="rounded-2xl border p-5 bg-muted/20">
              <p className="text-2xl text-muted-foreground">Residential address preview</p>
              <p className="text-3xl mt-2">{composedAddress || 'No address yet'}</p>
            </div>

            <div className="rounded-2xl border p-5 bg-muted/20">
              <p className="text-2xl text-muted-foreground">Pricing preview</p>
              <p className="text-3xl mt-2">Weekday: ${form.weekdayBasePrice} · Weekend: ${weekendPrice}</p>
            </div>

            <div className="rounded-2xl border p-5 bg-muted/20">
              <p className="text-2xl text-muted-foreground">Ready to publish</p>
              <p className="text-3xl mt-2">Your listing has {form.images.length} photos, {form.amenities.length} amenities, and booking settings configured.</p>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t pt-3 pb-4 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex gap-1 mb-5">
            <div className="h-1.5 flex-1 bg-muted rounded overflow-hidden"><div className="h-full bg-black" style={{ width: `${sectionProgress.step1 * 100}%` }} /></div>
            <div className="h-1.5 flex-1 bg-muted rounded overflow-hidden"><div className="h-full bg-black" style={{ width: `${sectionProgress.step2 * 100}%` }} /></div>
            <div className="h-1.5 flex-1 bg-muted rounded overflow-hidden"><div className="h-full bg-black" style={{ width: `${sectionProgress.step3 * 100}%` }} /></div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={back}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>

            {currentStep === 'final_details' ? (
              <Button onClick={publish} disabled={!canContinue || isSubmitting}>
                {isSubmitting ? 'Publishing...' : 'Create listing'}
              </Button>
            ) : (
              <Button onClick={next} disabled={!canContinue}>
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
