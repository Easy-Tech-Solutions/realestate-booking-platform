import React, { useMemo, useState, useEffect } from 'react';
import logo from '../../assets/logo2.jpg';
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
  | 'hotel_room_count'
  | 'hotel_rooms'
  | 'check_in_out'
  | 'land_details'
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
  | 'monthly_price'
  | 'payment_schedule'
  | 'safety'
  | 'final_details';

type PropertyGroup = 'residential' | 'hotel' | 'land' | 'commercial' | 'long_term_rental' | 'airbnb';

function getPropertyGroup(type: string): PropertyGroup {
  if (type === 'hotels') return 'hotel';
  if (type === 'land') return 'land';
  if (['apartment', 'room', 'house'].includes(type)) return 'long_term_rental';
  if (type === 'airbnb') return 'airbnb';
  if (['office-space', 'hall', 'roadside', 'highway'].includes(type)) return 'commercial';
  // lodge, beaches and any other short-term rental → nightly pricing, no guests field
  return 'residential';
}

const STEPS_BY_GROUP: Record<PropertyGroup, WizardStep[]> = {
  long_term_rental: [
    'welcome', 'step1_intro', 'property_type', 'privacy_type', 'location',
    'basics', 'amenities', 'photos', 'title', 'highlights', 'description',
    'step3_intro', 'monthly_price', 'payment_schedule',
    'safety', 'final_details',
  ],
  airbnb: [
    'welcome', 'step1_intro', 'property_type', 'privacy_type', 'location',
    'basics', 'amenities', 'photos', 'title', 'highlights', 'description',
    'step3_intro', 'discounts', 'weekday_price', 'weekend_price',
    'safety', 'final_details',
  ],
  residential: [
    'welcome', 'step1_intro', 'property_type', 'privacy_type', 'location',
    'basics', 'amenities', 'photos', 'title', 'highlights', 'description',
    'step3_intro', 'discounts', 'weekday_price', 'weekend_price',
    'safety', 'final_details',
  ],
  hotel: [
    'welcome', 'step1_intro', 'property_type', 'location',
    'hotel_room_count', 'hotel_rooms',
    'check_in_out', 'amenities', 'photos', 'title', 'description',
    'step3_intro', 'discounts',
    'final_details',
  ],
  land: [
    'welcome', 'step1_intro', 'property_type', 'location', 'land_details',
    'photos', 'title', 'description', 'step3_intro', 'weekday_price', 'final_details',
  ],
  commercial: [
    'welcome', 'step1_intro', 'property_type', 'location', 'basics',
    'amenities', 'photos', 'title', 'description',
    'step3_intro', 'discounts', 'weekday_price', 'final_details',
  ],
};

const HOTEL_AMENITIES = [
  { id: 'wifi', name: 'Wifi' },
  { id: 'room-service', name: 'Room service' },
  { id: 'concierge', name: 'Concierge' },
  { id: 'spa', name: 'Spa' },
  { id: 'restaurant', name: 'Restaurant' },
  { id: 'bar', name: 'Bar' },
  { id: 'pool', name: 'Swimming pool' },
  { id: 'gym', name: 'Gym' },
  { id: 'business-center', name: 'Business center' },
  { id: 'laundry', name: 'Laundry service' },
  { id: 'airport-shuttle', name: 'Airport shuttle' },
  { id: 'breakfast', name: 'Breakfast included' },
  { id: 'minibar', name: 'Minibar' },
  { id: 'safe', name: 'In-room safe' },
  { id: 'ac', name: 'Air conditioning' },
  { id: 'tv', name: 'TV' },
  { id: 'parking', name: 'Free parking' },
  { id: 'ev-charger', name: 'EV charger' },
];

const COMMERCIAL_AMENITIES = [
  { id: 'wifi', name: 'Wifi' },
  { id: 'projector', name: 'Projector' },
  { id: 'whiteboard', name: 'Whiteboard' },
  { id: 'conference-call', name: 'Conference call system' },
  { id: 'printing', name: 'Printing facilities' },
  { id: 'kitchen', name: 'Kitchen / kitchenette' },
  { id: 'parking', name: 'Free parking' },
  { id: 'security', name: 'Security' },
  { id: 'reception', name: 'Reception' },
  { id: 'ac', name: 'Air conditioning' },
  { id: 'tv', name: 'TV / Display screen' },
  { id: 'sound-system', name: 'Sound system' },
  { id: 'stage', name: 'Stage / Podium' },
  { id: 'catering', name: 'Catering available' },
];

const ROOM_TYPES_WIZARD = [
  { value: 'standard', label: 'Standard' },
  { value: 'deluxe', label: 'Deluxe' },
  { value: 'suite', label: 'Suite' },
  { value: 'family', label: 'Family' },
  { value: 'studio', label: 'Studio' },
  { value: 'penthouse', label: 'Penthouse' },
];

const BED_TYPES_WIZARD = [
  { value: 'king', label: 'King' },
  { value: 'queen', label: 'Queen' },
  { value: 'twin', label: 'Twin' },
  { value: 'double', label: 'Double' },
  { value: 'single', label: 'Single' },
  { value: 'bunk', label: 'Bunk' },
];

const ROOM_AMENITIES_WIZARD = [
  { id: 'wifi', name: 'Wifi' },
  { id: 'minibar', name: 'Minibar' },
  { id: 'safe', name: 'In-room safe' },
  { id: 'ac', name: 'Air conditioning' },
  { id: 'tv', name: 'TV' },
  { id: 'balcony', name: 'Balcony' },
  { id: 'jacuzzi', name: 'Jacuzzi' },
  { id: 'bathtub', name: 'Bathtub' },
  { id: 'room-service', name: 'Room service' },
  { id: 'ocean-view', name: 'Ocean view' },
  { id: 'city-view', name: 'City view' },
  { id: 'kitchenette', name: 'Kitchenette' },
];

type HotelRoomDraft = {
  name: string;
  roomType: string;
  description: string;
  pricePerNight: number;
  maxOccupancy: number;
  beds: number;
  bedType: string;
  bathrooms: number;
  amenities: string[];
  totalCount: number;
  roomImages: File[];
  roomImagePreviews: string[];
};

const defaultRoom: HotelRoomDraft = {
  name: '',
  roomType: 'standard',
  description: '',
  pricePerNight: 0,
  maxOccupancy: 2,
  beds: 1,
  bedType: 'queen',
  bathrooms: 1,
  amenities: [],
  totalCount: 1,
  roomImages: [],
  roomImagePreviews: [],
};

const HIGHLIGHTS = ['Peaceful', 'Unique', 'Family-friendly', 'Stylish', 'Central', 'Spacious'];

const CHECK_IN_TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const CHECK_OUT_TIMES = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00'];

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
  'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria',
  'Burkina Faso', 'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros',
  'Congo (Brazzaville)', 'Congo (Kinshasa)', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus',
  'Czech Republic', 'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador',
  'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini',
  'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany',
  'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana',
  'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq',
  'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya',
  'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho',
  'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar',
  'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania',
  'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro',
  'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands',
  'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia',
  'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea',
  'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
  'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore',
  'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
  'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Yemen', 'Zambia', 'Zimbabwe',
];

const DRAFT_KEY = 'create_listing_draft';

const GROUP_LABELS: Record<PropertyGroup, { place: string; title: string; description: string }> = {
  long_term_rental: {
    place: 'place',
    title: 'Now, let\'s give your place a title',
    description: 'Create your description',
  },
  airbnb: {
    place: 'place',
    title: 'Now, let\'s give your place a title',
    description: 'Create your description',
  },
  residential: {
    place: 'place',
    title: 'Now, let\'s give your place a title',
    description: 'Create your description',
  },
  hotel: {
    place: 'hotel / room',
    title: 'Give your hotel listing a name',
    description: 'Describe what guests can expect',
  },
  land: {
    place: 'land',
    title: 'Give your land listing a title',
    description: 'Describe the land and its potential',
  },
  commercial: {
    place: 'space',
    title: 'Give your space a name',
    description: 'Describe what makes your space ideal',
  },
};

export function CreateListing() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftListingId, setDraftListingId] = useState<string | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);

  const [form, setForm] = useState({
    propertyType: 'apartment',
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

    squareFootage: 0,
    checkInTime: '15:00',
    checkOutTime: '11:00',

    amenities: ['wifi', 'tv', 'kitchen', 'washer'] as string[],

    images: [] as File[],
    imagePreviews: [] as string[],

    title: '',
    description: '',
    highlights: [] as string[],

    bookingMode: 'approve_first_3',

    newListingPromo: false,
    lastMinuteDiscountEnabled: false,
    lastMinuteDiscountPercent: 7,
    weeklyDiscountEnabled: false,
    weeklyDiscountPercent: 10,
    monthlyDiscountEnabled: false,
    monthlyDiscountPercent: 15,

    weekdayBasePrice: 42,
    weekendPremiumPercent: 1,

    monthlyPrice: 500,
    paymentSchedule: 'monthly' as 'monthly' | 'quarterly' | 'biannual' | 'annual',

    exteriorCamera: false,
    noiseMonitor: false,
    weaponsOnProperty: false,
    safetyNotes: '',

    hotelRoomCount: 1,
    hotelRooms: [{ ...defaultRoom }] as HotelRoomDraft[],
  });

  const propertyGroup = useMemo(() => getPropertyGroup(form.propertyType), [form.propertyType]);
  const steps = useMemo(() => STEPS_BY_GROUP[propertyGroup], [propertyGroup]);
  const currentStep = steps[stepIndex];
  const groupLabels = GROUP_LABELS[propertyGroup];

  const currentAmenities = useMemo(() => {
    if (propertyGroup === 'hotel') return HOTEL_AMENITIES;
    if (propertyGroup === 'commercial') return COMMERCIAL_AMENITIES;
    return AMENITIES;
  }, [propertyGroup]);

  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_KEY);
    if (!saved) return;
    try {
      const { form: savedForm, stepIndex: savedStep, draftListingId: savedDraftId } = JSON.parse(saved);
      // Restore rooms with file fields defaulted — File objects can't be serialized
      const restoredRooms = (savedForm.hotelRooms || []).map((r: any) => ({
        ...defaultRoom,
        ...r,
        roomImages: [],
        roomImagePreviews: [],
      }));
      setForm((prev) => ({
        ...prev,
        ...savedForm,
        hotelRooms: restoredRooms,
        images: [],
        imagePreviews: [],
      }));
      setStepIndex(savedStep ?? 0);
      if (savedDraftId) setDraftListingId(savedDraftId);
      setDraftRestored(true);
      toast.info('Draft restored — please re-add your photos.');
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  // If property type changes and current step no longer exists in the new flow, go back to property_type
  useEffect(() => {
    if (currentStep && !steps.includes(currentStep)) {
      setStepIndex(2);
    }
  }, [steps, currentStep]);

  const saveAndExit = async () => {
    // Always persist form state to localStorage immediately
    const { images, imagePreviews, ...serializableForm } = form;
    const serializableRooms = serializableForm.hotelRooms.map(
      ({ roomImages, roomImagePreviews, ...rest }) => rest
    );
    const localDraftId = draftListingId;
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      form: { ...serializableForm, hotelRooms: serializableRooms },
      stepIndex,
      draftListingId: localDraftId,
    }));

    setIsSavingDraft(true);
    try {
      const payload = new FormData();
      payload.append('title', form.title.trim() || 'Untitled Draft');
      payload.append('description', form.description || '');
      payload.append('property_type', form.propertyType);
      payload.append('privacy_type', propertyGroup === 'hotel' ? 'private_room' : (form.privacyType || 'entire_place'));
      payload.append('address', composedAddress || form.address1 || '');
      payload.append('city', form.city || '');
      payload.append('state', form.state || '');
      payload.append('country', form.country || 'Rwanda');
      payload.append('price', String(form.weekdayBasePrice || 0));
      payload.append('amenities', JSON.stringify(form.amenities));
      payload.append('highlights', JSON.stringify(form.highlights));
      payload.append('bedrooms', String(form.bedrooms || 0));
      payload.append('beds', String(form.beds || 0));
      payload.append('bathrooms', String(form.bathrooms || 0));
      payload.append('max_guests', String(form.guests || 1));
      payload.append('square_footage', String(form.squareFootage || 0));
      payload.append('check_in_time', form.checkInTime || '15:00');
      payload.append('check_out_time', form.checkOutTime || '11:00');
      payload.append('status', 'draft');

      let savedId: string;
      if (localDraftId) {
        const updated = await propertiesAPI.update(localDraftId, payload);
        savedId = updated.id;
      } else {
        const created = await propertiesAPI.create(payload);
        savedId = created.id;
        setDraftListingId(savedId);
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ form: serializableForm, stepIndex, draftListingId: savedId }));
      }

      // Upload any selected photos to the server so they survive the draft
      if (images.length > 0) {
        const uploadedUrls: string[] = [];
        try {
          if (images[0]) {
            const coverPayload = new FormData();
            coverPayload.append('main_image', images[0]);
            const updated2 = await propertiesAPI.update(savedId, coverPayload);
            if (updated2.images?.[0]) uploadedUrls.push(updated2.images[0]);
          }
          for (let i = 1; i < Math.min(images.length, 11); i++) {
            const res = await propertiesAPI.addGalleryImage(savedId, images[i], '', i - 1);
            if (res?.image_url || res?.imageUrl) uploadedUrls.push(res.image_url || res.imageUrl);
          }
        } catch { /* silent — photos will re-upload on publish */ }
        if (uploadedUrls.length > 0) {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({
            form: { ...serializableForm, hotelRooms: serializableRooms, savedImageUrls: uploadedUrls },
            stepIndex,
            draftListingId: savedId,
          }));
        }
      }

      toast.success('Draft saved — photos and all details preserved.');
    } catch {
      toast.success('Draft saved locally.');
    } finally {
      setIsSavingDraft(false);
    }

    navigate('/host');
  };

  const categoriesQuery = useQuery({
    queryKey: ['property-categories', 'create-listing'],
    queryFn: () => propertiesAPI.listCategories(),
  });
  const listingCategories = (categoriesQuery.data || []).length
    ? (categoriesQuery.data || []).map((category) => ({ id: category.slug, name: category.name }))
    : PROPERTY_CATEGORIES.map((category) => ({ id: category.id, name: category.name }));

  const update = (patch: Partial<typeof form>) => setForm((prev) => ({ ...prev, ...patch }));

  const setHotelRoomCount = (count: number) => {
    const clamped = Math.max(1, Math.min(20, count));
    setForm((prev) => {
      const rooms = [...prev.hotelRooms];
      while (rooms.length < clamped) rooms.push({ ...defaultRoom });
      return { ...prev, hotelRoomCount: clamped, hotelRooms: rooms.slice(0, clamped) };
    });
  };

  const updateRoom = (index: number, patch: Partial<HotelRoomDraft>) =>
    setForm((prev) => {
      const rooms = [...prev.hotelRooms];
      rooms[index] = { ...rooms[index], ...patch };
      return { ...prev, hotelRooms: rooms };
    });

  const toggleRoomAmenity = (index: number, amenityId: string) =>
    updateRoom(index, {
      amenities: form.hotelRooms[index].amenities.includes(amenityId)
        ? form.hotelRooms[index].amenities.filter((a) => a !== amenityId)
        : [...form.hotelRooms[index].amenities, amenityId],
    });

  const onRoomPhotosSelected = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const room = form.hotelRooms[index];
    const nextImages = [...room.roomImages, ...files].slice(0, 10);
    const nextPreviews = nextImages.map((f) => URL.createObjectURL(f));
    updateRoom(index, { roomImages: nextImages, roomImagePreviews: nextPreviews });
  };

  const removeRoomPhoto = (roomIndex: number, photoIndex: number) => {
    const room = form.hotelRooms[roomIndex];
    updateRoom(roomIndex, {
      roomImages: room.roomImages.filter((_, i) => i !== photoIndex),
      roomImagePreviews: room.roomImagePreviews.filter((_, i) => i !== photoIndex),
    });
  };

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
    return [form.address1, form.address2, form.city, form.state, form.country, form.postalCode]
      .filter(Boolean)
      .join(', ');
  }, [form]);

  const sectionProgress = useMemo(() => {
    const s1Start = steps.indexOf('step1_intro');
    const s1End = steps.indexOf('description');
    const s2Start = steps.indexOf('step3_intro');
    const s2End = steps.indexOf('final_details');

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
  }, [stepIndex, steps]);

  const minPhotos = propertyGroup === 'land' ? 1 : propertyGroup === 'commercial' ? 3 : 5;

  const canContinue = useMemo(() => {
    switch (currentStep) {
      case 'property_type': return Boolean(form.propertyType);
      case 'privacy_type': return Boolean(form.privacyType);
      case 'location': return Boolean(form.address1 && form.city && form.country);
      case 'hotel_room_count': return form.hotelRoomCount >= 1;
      case 'hotel_rooms': return form.hotelRooms.every((r) => r.name.trim() && r.pricePerNight > 0);
      case 'photos': return form.images.length >= minPhotos;
      case 'title': return form.title.trim().length > 0;
      case 'description': return form.description.trim().length > 0;
      case 'land_details': return form.squareFootage > 0;
      case 'monthly_price': return form.monthlyPrice >= 50;
      case 'final_details': return Boolean(form.address1 && form.city && form.country);
      default: return true;
    }
  }, [currentStep, form, minPhotos]);

  const next = () => {
    if (!canContinue) return;
    if (stepIndex < steps.length - 1) setStepIndex((s) => s + 1);
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

    if (form.images.length === 0) {
      toast.error('Please add at least one photo before publishing.');
      const photosIdx = steps.indexOf('photos');
      if (photosIdx !== -1) setStepIndex(photosIdx);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = new FormData();
      payload.append('title', form.title);
      payload.append('description', form.description);
      payload.append('property_type', form.propertyType);
      payload.append('privacy_type', propertyGroup === 'hotel' ? 'private_room' : form.privacyType);
      payload.append('address', composedAddress);
      payload.append('city', form.city);
      payload.append('state', form.state);
      payload.append('country', form.country);
      payload.append('price', String(propertyGroup === 'long_term_rental' ? form.monthlyPrice : form.weekdayBasePrice));
      payload.append('pricing_type', propertyGroup === 'long_term_rental' ? 'monthly' : 'nightly');
      if (propertyGroup === 'long_term_rental') {
        payload.append('payment_schedule', form.paymentSchedule);
      }
      payload.append('bedrooms', String(propertyGroup === 'hotel' || propertyGroup === 'commercial' ? 0 : form.bedrooms));
      payload.append('beds', String(propertyGroup === 'land' || propertyGroup === 'commercial' || propertyGroup === 'long_term_rental' ? 0 : propertyGroup === 'hotel' ? 0 : form.beds));
      payload.append('bathrooms', String(propertyGroup === 'land' ? 0 : propertyGroup === 'hotel' ? 0 : form.bathrooms));
      payload.append('max_guests', String(
        propertyGroup === 'hotel'
          ? Math.max(...form.hotelRooms.map((r) => r.maxOccupancy), 1)
          : propertyGroup === 'long_term_rental' || propertyGroup === 'residential'
            ? 0
            : form.guests  // airbnb, commercial
      ));
      payload.append('amenities', JSON.stringify(form.amenities));
      payload.append('highlights', JSON.stringify(form.highlights));
      payload.append('booking_mode', form.bookingMode.startsWith('approve') ? 'approve_first' : 'instant');
      payload.append('weekend_premium_percent', String(propertyGroup === 'land' ? 0 : form.weekendPremiumPercent));
      payload.append('new_listing_promo', String(form.newListingPromo));
      payload.append('last_minute_discount_enabled', String(form.lastMinuteDiscountEnabled));
      payload.append('last_minute_discount_percent', String(form.lastMinuteDiscountPercent));
      payload.append('weekly_discount_enabled', String(form.weeklyDiscountEnabled));
      payload.append('weekly_discount_percent', String(form.weeklyDiscountPercent));
      payload.append('monthly_discount_enabled', String(form.monthlyDiscountEnabled));
      payload.append('monthly_discount_percent', String(form.monthlyDiscountPercent));
      const hasSafety = propertyGroup === 'residential' || propertyGroup === 'airbnb' || propertyGroup === 'long_term_rental';
      payload.append('exterior_camera', String(hasSafety ? form.exteriorCamera : false));
      payload.append('noise_monitor', String(hasSafety ? form.noiseMonitor : false));
      payload.append('weapons_on_property', String(hasSafety ? form.weaponsOnProperty : false));
      if (form.safetyNotes) payload.append('safety_notes', form.safetyNotes);
      payload.append('square_footage', String(form.squareFootage));
      payload.append('check_in_time', form.checkInTime);
      payload.append('check_out_time', form.checkOutTime);
      payload.append('is_available', 'true');
      payload.append('status', 'pending_review');

      if (form.images[0]) {
        payload.append('main_image', form.images[0]);
      }

      const created = draftListingId
        ? await propertiesAPI.update(draftListingId, payload)
        : await propertiesAPI.create(payload);

      if (form.images.length > 1) {
        const remaining = form.images.slice(1, 11);
        for (const [idx, file] of remaining.entries()) {
          await propertiesAPI.addGalleryImage(created.id, file, '', idx);
        }
      }

      if (propertyGroup === 'hotel') {
        for (const room of form.hotelRooms) {
          if (room.name.trim() && room.pricePerNight > 0) {
            const createdRoom = await propertiesAPI.createRoom(created.id, {
              name: room.name,
              roomType: room.roomType as any,
              description: room.description,
              pricePerNight: room.pricePerNight,
              maxOccupancy: room.maxOccupancy,
              beds: room.beds,
              bedType: room.bedType as any,
              bathrooms: room.bathrooms,
              amenities: room.amenities,
              totalCount: room.totalCount,
              isActive: true,
            });
            for (const file of room.roomImages) {
              await propertiesAPI.uploadRoomImage(created.id, createdRoom.id, file);
            }
          }
        }
      }

      localStorage.removeItem(DRAFT_KEY);
      toast.success('Listing submitted for review! Our team will approve it shortly.');
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

  const guestPriceBeforeTaxes = Math.round(form.weekdayBasePrice * 1.04);
  const weekendPrice = Math.round(form.weekdayBasePrice * (1 + form.weekendPremiumPercent / 100));

  // Basics step rows — differ by property group
  const basicsRows = useMemo(() => {
    if (propertyGroup === 'commercial') {
      return [{ label: 'Capacity', key: 'guests' as const }];
    }
    if (propertyGroup === 'hotel') {
      return [
        { label: 'Max guests per room', key: 'guests' as const },
        { label: 'Beds', key: 'beds' as const },
        { label: 'Bathrooms', key: 'bathrooms' as const },
      ];
    }
    if (propertyGroup === 'long_term_rental') {
      return [
        { label: 'Bedrooms', key: 'bedrooms' as const },
        { label: 'Bathrooms', key: 'bathrooms' as const },
      ];
    }
    if (propertyGroup === 'airbnb') {
      return [
        { label: 'Guests', key: 'guests' as const },
        { label: 'Bedrooms', key: 'bedrooms' as const },
        { label: 'Beds', key: 'beds' as const },
        { label: 'Bathrooms', key: 'bathrooms' as const },
      ];
    }
    // residential (lodge, beaches, etc.) — no guests field
    return [
      { label: 'Bedrooms', key: 'bedrooms' as const },
      { label: 'Beds', key: 'beds' as const },
      { label: 'Bathrooms', key: 'bathrooms' as const },
    ];
  }, [propertyGroup]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="px-4 sm:px-8 py-4 sm:py-6 flex items-center justify-between flex-wrap gap-3">
        <div className="text-xl sm:text-2xl font-semibold tracking-tight">
          <img src={logo} alt="HomeKonet" className="h-10 w-auto" />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={saveAndExit} disabled={isSavingDraft}>
            {isSavingDraft ? 'Saving...' : 'Save & exit'}
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 pb-10">

        {currentStep === 'welcome' && (
          <div className="grid lg:grid-cols-2 gap-8 items-center py-8">
            <div>
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-semibold leading-tight">It's easy to get started on HomeKonet</h1>
            </div>
            <div className="space-y-6">
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <p className="text-xl sm:text-3xl font-semibold">1</p>
                  <p className="text-xl sm:text-3xl font-semibold">Tell us about your place</p>
                  <p className="text-muted-foreground text-base sm:text-2xl">Share basic info, like where it is and how many guests can stay.</p>
                </div>
              </div>
              <div className="flex items-start justify-between border-b pb-4">
                <div>
                  <p className="text-xl sm:text-3xl font-semibold">2</p>
                  <p className="text-xl sm:text-3xl font-semibold">Make it stand out</p>
                  <p className="text-muted-foreground text-base sm:text-2xl">Add photos plus a title and description.</p>
                </div>
              </div>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xl sm:text-3xl font-semibold">3</p>
                  <p className="text-xl sm:text-3xl font-semibold">Finish up and publish</p>
                  <p className="text-muted-foreground text-base sm:text-2xl">Set booking settings, pricing, and publish.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentStep === 'step1_intro' && (
          <div className="grid lg:grid-cols-2 gap-8 items-center py-10">
            <div>
              <p className="text-lg sm:text-2xl text-muted-foreground mb-2">Step 1</p>
              <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-4">Tell us about your place</h2>
              <p className="text-lg sm:text-2xl text-muted-foreground">We'll ask what type of property you have and where guests can stay.</p>
            </div>
            <div className="rounded-3xl border p-8 text-center text-muted-foreground">Property setup</div>
          </div>
        )}

        {currentStep === 'property_type' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-8">Which of these best describes your place?</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {listingCategories.map((type) => (
                <button
                  type="button"
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
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-8">What type of place will guests have?</h2>
            <div className="space-y-4">
              {[
                { id: 'entire_place', title: 'An entire place', subtitle: 'Guests have the whole place to themselves.' },
                { id: 'private_room', title: 'A private room', subtitle: 'Guests have their own room and shared spaces.' },
                { id: 'shared_room', title: 'A shared room in a hostel', subtitle: 'Guests sleep in a shared room.' },
              ].map((option) => (
                <button
                  type="button"
                  key={option.id}
                  onClick={() => update({ privacyType: option.id as 'entire_place' | 'private_room' | 'shared_room' })}
                  className={cn(
                    'w-full border rounded-2xl p-6 text-left transition',
                    form.privacyType === option.id ? 'border-2 border-foreground' : 'hover:border-foreground'
                  )}
                >
                  <p className="text-xl sm:text-3xl font-medium mb-1">{option.title}</p>
                  <p className="text-muted-foreground text-base sm:text-2xl">{option.subtitle}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'location' && (
          <section className="max-w-3xl mx-auto py-8 space-y-6">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold">Where's your {groupLabels.place} located?</h2>
            <p className="text-base sm:text-2xl text-muted-foreground">We only share your address with guests after booking.</p>
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

        {currentStep === 'hotel_room_count' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">How many room types does your hotel have?</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">
              A room type is a category of rooms with the same specs and price (e.g. Standard, Deluxe Suite). You can add more later.
            </p>
            <div className="flex items-center justify-between py-5 border-b">
              <p className="text-xl sm:text-3xl">Number of room types</p>
              <div className="flex items-center gap-5">
                <button
                  type="button"
                  aria-label="Decrease room count"
                  className="w-10 h-10 rounded-full border flex items-center justify-center"
                  onClick={() => setHotelRoomCount(form.hotelRoomCount - 1)}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-xl sm:text-3xl font-medium w-8 text-center">{form.hotelRoomCount}</span>
                <button
                  type="button"
                  aria-label="Increase room count"
                  className="w-10 h-10 rounded-full border flex items-center justify-center"
                  onClick={() => setHotelRoomCount(form.hotelRoomCount + 1)}
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        )}

        {currentStep === 'hotel_rooms' && (
          <section className="max-w-3xl mx-auto py-8 space-y-8">
            <div>
              <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Tell us about your room types</h2>
              <p className="text-base sm:text-2xl text-muted-foreground">Fill in the details for each room type. Fields marked * are required.</p>
            </div>
            {form.hotelRooms.map((room, idx) => (
              <div key={idx} className="border rounded-2xl p-6 space-y-5">
                <h3 className="text-xl sm:text-2xl font-semibold">Room type {idx + 1}</h3>

                {/* Name + type */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Room name *</label>
                    <Input
                      placeholder="e.g. Deluxe Ocean View"
                      value={room.name}
                      onChange={(e) => updateRoom(idx, { name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Room type</label>
                    <select
                      aria-label="Room type"
                      value={room.roomType}
                      onChange={(e) => updateRoom(idx, { roomType: e.target.value })}
                      className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {ROOM_TYPES_WIZARD.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Description</label>
                  <textarea
                    rows={2}
                    placeholder="Describe this room type..."
                    value={room.description}
                    onChange={(e) => updateRoom(idx, { description: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </div>

                {/* Price + inventory */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Price per night (USD) *</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={room.pricePerNight || ''}
                      onChange={(e) => updateRoom(idx, { pricePerNight: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Number of rooms (inventory)</label>
                    <div className="flex items-center gap-3">
                      <button type="button" aria-label="Decrease room count" className="w-8 h-8 rounded-full border flex items-center justify-center" onClick={() => updateRoom(idx, { totalCount: Math.max(1, room.totalCount - 1) })}>
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-base font-medium w-6 text-center">{room.totalCount}</span>
                      <button type="button" aria-label="Increase room count" className="w-8 h-8 rounded-full border flex items-center justify-center" onClick={() => updateRoom(idx, { totalCount: room.totalCount + 1 })}>
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Capacity rows */}
                {[
                  { label: 'Max guests per room', field: 'maxOccupancy' as const },
                  { label: 'Beds', field: 'beds' as const },
                  { label: 'Bathrooms', field: 'bathrooms' as const },
                ].map(({ label, field }) => (
                  <div key={field} className="flex items-center justify-between py-3 border-b">
                    <p className="text-base sm:text-xl">{label}</p>
                    <div className="flex items-center gap-4">
                      <button type="button" aria-label={`Decrease ${label}`} className="w-8 h-8 rounded-full border flex items-center justify-center" onClick={() => updateRoom(idx, { [field]: Math.max(1, room[field] - 1) })}>
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-base font-medium w-6 text-center">{room[field]}</span>
                      <button type="button" aria-label={`Increase ${label}`} className="w-8 h-8 rounded-full border flex items-center justify-center" onClick={() => updateRoom(idx, { [field]: room[field] + 1 })}>
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Bed type */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Bed type</label>
                  <select
                    aria-label="Bed type"
                    value={room.bedType}
                    onChange={(e) => updateRoom(idx, { bedType: e.target.value })}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {BED_TYPES_WIZARD.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                {/* Room amenities */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Room amenities</label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {ROOM_AMENITIES_WIZARD.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleRoomAmenity(idx, a.id)}
                        className={cn(
                          'px-3 py-2 rounded-lg border text-sm text-left transition-colors',
                          room.amenities.includes(a.id)
                            ? 'border-foreground bg-muted'
                            : 'hover:border-foreground'
                        )}
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Room photos */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">Room photos (optional, up to 10)</label>
                  <label className="border-2 border-dashed rounded-xl flex flex-col items-center justify-center py-6 cursor-pointer hover:border-foreground transition">
                    <Camera className="w-8 h-8 mb-2 text-muted-foreground" />
                    <span className="text-sm font-medium">Add photos for this room type</span>
                    <span className="text-xs text-muted-foreground mt-1">{room.roomImages.length} selected</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => onRoomPhotosSelected(idx, e)}
                    />
                  </label>
                  {room.roomImagePreviews.length > 0 && (
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                      {room.roomImagePreviews.map((preview, photoIdx) => (
                        <div key={photoIdx} className="relative group border rounded-lg overflow-hidden">
                          <img src={preview} alt={`Room ${idx + 1} photo ${photoIdx + 1}`} className="w-full h-20 object-cover" />
                          <button
                            type="button"
                            aria-label={`Remove photo ${photoIdx + 1}`}
                            className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 text-white text-xs"
                            onClick={() => removeRoomPhoto(idx, photoIdx)}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {currentStep === 'basics' && (
          <section className="max-w-3xl mx-auto py-8">
            {propertyGroup === 'commercial' ? (
              <>
                <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Share some basics about your space</h2>
                <p className="text-base sm:text-2xl text-muted-foreground mb-8">How many people can your space accommodate?</p>
              </>
            ) : propertyGroup === 'hotel' ? (
              <>
                <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Tell us about this room</h2>
                <p className="text-base sm:text-2xl text-muted-foreground mb-8">Share details about the room's capacity and facilities.</p>
              </>
            ) : (
              <>
                <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Share some basics about your place</h2>
                <p className="text-base sm:text-2xl text-muted-foreground mb-8">You'll add more details later, like bed types.</p>
              </>
            )}
            <div className="space-y-2">
              {basicsRows.map(({ label, key }) => (
                <div key={key} className="flex items-center justify-between py-5 border-b">
                  <p className="text-xl sm:text-3xl">{label}</p>
                  <div className="flex items-center gap-5">
                    <button type="button" aria-label={`Decrease ${label}`} className="w-10 h-10 rounded-full border flex items-center justify-center" onClick={() => updateCount(key, -1)}>
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-xl sm:text-3xl font-medium w-8 text-center">{form[key]}</span>
                    <button type="button" aria-label={`Increase ${label}`} className="w-10 h-10 rounded-full border flex items-center justify-center" onClick={() => updateCount(key, 1)}>
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'check_in_out' && (
          <section className="max-w-3xl mx-auto py-8 space-y-8">
            <div>
              <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Set check-in and check-out times</h2>
              <p className="text-base sm:text-2xl text-muted-foreground">Let guests know when they can arrive and when they need to leave.</p>
            </div>
            <div className="space-y-6">
              <div>
                <Label className="text-xl sm:text-2xl mb-3 block">Check-in time</Label>
                <div className="flex flex-wrap gap-3">
                  {CHECK_IN_TIMES.map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => update({ checkInTime: t })}
                      className={cn(
                        'px-5 py-3 rounded-xl border text-base sm:text-xl font-medium transition',
                        form.checkInTime === t ? 'border-2 border-foreground bg-muted' : 'hover:border-foreground'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xl sm:text-2xl mb-3 block">Check-out time</Label>
                <div className="flex flex-wrap gap-3">
                  {CHECK_OUT_TIMES.map((t) => (
                    <button
                      type="button"
                      key={t}
                      onClick={() => update({ checkOutTime: t })}
                      className={cn(
                        'px-5 py-3 rounded-xl border text-base sm:text-xl font-medium transition',
                        form.checkOutTime === t ? 'border-2 border-foreground bg-muted' : 'hover:border-foreground'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {currentStep === 'land_details' && (
          <section className="max-w-3xl mx-auto py-8 space-y-8">
            <div>
              <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Tell us about the land</h2>
              <p className="text-base sm:text-2xl text-muted-foreground">Share the size and key characteristics of the property.</p>
            </div>
            <div className="space-y-6">
              <div>
                <Label className="text-xl sm:text-2xl mb-2 block">Total area (sq ft)</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="e.g. 10000"
                  value={form.squareFootage || ''}
                  onChange={(e) => update({ squareFootage: Number(e.target.value) })}
                  className="text-xl"
                />
                {form.squareFootage > 0 && (
                  <p className="text-sm text-muted-foreground mt-1">
                    ≈ {(form.squareFootage / 43560).toFixed(2)} acres
                  </p>
                )}
              </div>
              <div className="space-y-4">
                <Label className="text-xl sm:text-2xl block">Land features</Label>
                {[
                  { id: 'road-access', name: 'Road access' },
                  { id: 'fenced', name: 'Fenced' },
                  { id: 'water-supply', name: 'Water supply' },
                  { id: 'electricity', name: 'Electricity connection' },
                  { id: 'flat-terrain', name: 'Flat terrain' },
                  { id: 'trees', name: 'Trees / vegetation' },
                ].map((feature) => (
                  <div key={feature.id} className="flex items-center justify-between py-3 border-b">
                    <p className="text-xl sm:text-2xl">{feature.name}</p>
                    <Checkbox
                      checked={form.amenities.includes(feature.id)}
                      onCheckedChange={() => toggleAmenity(feature.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {currentStep === 'amenities' && (
          <section className="max-w-4xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">
              {propertyGroup === 'hotel'
                ? 'What does your hotel offer?'
                : propertyGroup === 'commercial'
                ? 'What does your space have?'
                : 'Tell guests what your place has to offer'}
            </h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">You can add more after publishing.</p>
            <div className="grid sm:grid-cols-3 gap-4">
              {currentAmenities.map((amenity) => (
                <button
                  type="button"
                  key={amenity.id}
                  onClick={() => toggleAmenity(amenity.id)}
                  className={cn(
                    'border rounded-2xl p-5 text-left transition',
                    form.amenities.includes(amenity.id) ? 'border-2 border-foreground' : 'hover:border-foreground'
                  )}
                >
                  <p className="text-base sm:text-xl font-medium mb-1">{amenity.name}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'photos' && (
          <section className="max-w-4xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">
              {propertyGroup === 'land' ? 'Add photos of the land' : `Add some photos of your ${groupLabels.place}`}
            </h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">
              You'll need at least {minPhotos} photo{minPhotos !== 1 ? 's' : ''} to get started.
            </p>

            {draftRestored && form.images.length === 0 && (
              <div className="mb-6 rounded-xl border border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
                ⚠️ Photos are not saved in drafts. Please re-upload your photos before publishing.
              </div>
            )}

            <label className="border-2 border-dashed rounded-2xl min-h-[340px] flex flex-col items-center justify-center cursor-pointer hover:border-foreground transition">
              <Camera className="w-14 h-14 mb-4 text-muted-foreground" />
              <p className="text-xl sm:text-3xl font-medium mb-1">Drag and drop</p>
              <p className="text-muted-foreground text-base sm:text-2xl mb-4">or browse for photos</p>
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
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">{groupLabels.title}</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">Short titles work best. You can always edit later.</p>
            <Textarea
              rows={6}
              maxLength={50}
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder={`Enter ${groupLabels.place} title`}
            />
            <p className="text-sm text-muted-foreground mt-2">{form.title.length}/50</p>
          </section>
        )}

        {currentStep === 'highlights' && (
          <section className="max-w-3xl mx-auto py-8 space-y-8">
            <div>
              <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Next, let's describe your place</h2>
              <p className="text-base sm:text-2xl text-muted-foreground mb-6">Choose up to 2 highlights.</p>
              <div className="flex flex-wrap gap-3">
                {HIGHLIGHTS.map((h) => (
                  <button
                    type="button"
                    key={h}
                    onClick={() => toggleHighlight(h)}
                    className={cn(
                      'px-5 py-3 rounded-full border text-base sm:text-xl',
                      form.highlights.includes(h) ? 'border-foreground bg-muted' : 'hover:border-foreground'
                    )}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xl sm:text-2xl font-semibold mb-2 block">Write a description</Label>
              <p className="text-base text-muted-foreground mb-3">Tell guests what makes your {groupLabels.place} special.</p>
              <Textarea
                rows={6}
                maxLength={500}
                value={form.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder={`Describe your ${groupLabels.place}…`}
              />
              <p className="text-sm text-muted-foreground mt-1">{form.description.length}/500</p>
            </div>
          </section>
        )}

        {currentStep === 'description' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">{groupLabels.description}</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">Share what makes your {groupLabels.place} special.</p>
            <Textarea
              rows={8}
              maxLength={500}
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder={`Describe your ${groupLabels.place}`}
            />
            <p className="text-sm text-muted-foreground mt-2">{form.description.length}/500</p>
          </section>
        )}

        {currentStep === 'step3_intro' && (
          <div className="grid lg:grid-cols-2 gap-10 items-center py-12">
            <div>
              <p className="text-base sm:text-2xl text-muted-foreground mb-2">Step 3</p>
              <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-4">Finish up and publish</h2>
              <p className="text-xl sm:text-3xl text-muted-foreground">Choose booking settings, set up pricing, and publish your listing.</p>
            </div>
            <div className="rounded-3xl border p-10 text-center text-muted-foreground">Publishing setup</div>
          </div>
        )}

        {currentStep === 'booking_settings' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Pick your booking settings</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">You can change this at any time.</p>
            <div className="space-y-4">
              {[
                { id: 'approve_first_3', title: 'Approve your first 3 bookings', subtitle: 'Recommended for new hosts.' },
                { id: 'instant_book', title: 'Use Instant Book', subtitle: 'Let guests book automatically.' },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.id}
                  onClick={() => update({ bookingMode: opt.id })}
                  className={cn(
                    'w-full border rounded-2xl p-6 text-left',
                    form.bookingMode === opt.id ? 'border-2 border-foreground' : 'hover:border-foreground'
                  )}
                >
                  <p className="text-xl sm:text-3xl font-medium">{opt.title}</p>
                  <p className="text-base sm:text-2xl text-muted-foreground">{opt.subtitle}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'discounts' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Add discounts <span className="text-2xl sm:text-3xl font-normal text-muted-foreground">(optional)</span></h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">All discounts are optional. Enable only the ones you'd like to offer — you can change them any time.</p>
            <div className="space-y-4">
              {[
                { key: 'newListingPromo', title: 'New listing promotion', description: 'Offer 20% off your first 3 bookings', value: true },
                { key: 'lastMinuteDiscountEnabled', title: 'Last-minute discount', description: 'For stays booked 14 days or less before arrival', value: form.lastMinuteDiscountPercent },
                { key: 'weeklyDiscountEnabled', title: 'Weekly discount', description: 'For stays of 7 nights or more', value: form.weeklyDiscountPercent },
                { key: 'monthlyDiscountEnabled', title: 'Monthly discount', description: 'For stays of 28 nights or more', value: form.monthlyDiscountPercent },
              ].map((item) => {
                const enabled = form[item.key as keyof typeof form] as boolean;
                return (
                  <div key={item.key} className="border rounded-2xl p-5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-16 h-12 rounded-xl border flex-shrink-0 flex items-center justify-center text-xl sm:text-3xl font-semibold">
                        {typeof item.value === 'number' ? `${item.value}%` : '20%'}
                      </div>
                      <div className="min-w-0">
                        <p className="text-base sm:text-xl font-medium">{item.title}</p>
                        <p className="text-sm sm:text-base text-muted-foreground">{item.description}</p>
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
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">
              {propertyGroup === 'land' || propertyGroup === 'commercial'
                ? 'Set your daily price'
                : 'Now, set a weekday base price'}
            </h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">
              {propertyGroup === 'land' ? 'Price per day for the land.' : 'You\'ll set a weekend premium on the next step.'}
            </p>
            <div className="text-[60px] sm:text-[90px] lg:text-[120px] font-semibold leading-none">${form.weekdayBasePrice}</div>
            <p className="text-xl sm:text-3xl text-muted-foreground mt-3">
              Guest price before taxes ${guestPriceBeforeTaxes} <ChevronDown className="inline w-5 h-5" />
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Button type="button" variant="outline" size="sm" onClick={() => update({ weekdayBasePrice: Math.max(10, form.weekdayBasePrice - 10) })}>-10</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => update({ weekdayBasePrice: Math.max(10, form.weekdayBasePrice - 1) })}>-1</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => update({ weekdayBasePrice: form.weekdayBasePrice + 1 })}>+1</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => update({ weekdayBasePrice: form.weekdayBasePrice + 10 })}>+10</Button>
            </div>
            <div className="max-w-sm mx-auto mt-6">
              <Label htmlFor="weekday-price-input" className="text-base">Or type a price</Label>
              <Input
                id="weekday-price-input"
                type="number"
                min={10}
                value={form.weekdayBasePrice}
                onChange={(e) => update({ weekdayBasePrice: Math.max(10, Number(e.target.value) || 10) })}
                className="mt-2 text-center text-lg"
              />
            </div>
          </section>
        )}

        {currentStep === 'weekend_price' && (
          <section className="max-w-3xl mx-auto py-8 text-center">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Set a weekend price</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">
              Optional — add a premium for Fridays and Saturdays, or leave at 0% to keep the same price.
            </p>
            <div className="text-[60px] sm:text-[90px] lg:text-[120px] font-semibold leading-none">${weekendPrice}</div>
            <p className="text-xl sm:text-3xl text-muted-foreground mt-3">
              Guest price before taxes ${Math.round(weekendPrice * 1.04)} <ChevronDown className="inline w-5 h-5" />
            </p>
            <div className="max-w-xl mx-auto mt-10 text-left">
              <p className="text-xl sm:text-3xl font-medium mb-2">Weekend premium</p>
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
                <Input
                  type="number"
                  min={0}
                  max={99}
                  value={form.weekendPremiumPercent}
                  onChange={(e) => update({ weekendPremiumPercent: Math.min(99, Math.max(0, Number(e.target.value) || 0)) })}
                  className="w-20 text-center text-xl font-semibold"
                />
              </div>
            </div>
          </section>
        )}

        {currentStep === 'monthly_price' && (
          <section className="max-w-3xl mx-auto py-8 text-center">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Set your monthly rent</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">
              This is the rent tenants will pay per month. You'll choose the payment schedule next.
            </p>
            <div className="text-[60px] sm:text-[90px] lg:text-[120px] font-semibold leading-none">
              ${form.monthlyPrice}
            </div>
            <p className="text-xl sm:text-3xl text-muted-foreground mt-3">per month</p>
            <div className="mt-8 flex justify-center gap-3">
              <Button variant="outline" size="sm" onClick={() => update({ monthlyPrice: Math.max(50, form.monthlyPrice - 50) })}>-50</Button>
              <Button variant="outline" size="sm" onClick={() => update({ monthlyPrice: Math.max(50, form.monthlyPrice - 10) })}>-10</Button>
              <Button variant="outline" size="sm" onClick={() => update({ monthlyPrice: form.monthlyPrice + 10 })}>+10</Button>
              <Button variant="outline" size="sm" onClick={() => update({ monthlyPrice: form.monthlyPrice + 50 })}>+50</Button>
            </div>
            <div className="max-w-sm mx-auto mt-8">
              <Label htmlFor="monthly-price-input" className="text-base">Or enter an exact amount</Label>
              <Input
                id="monthly-price-input"
                type="number"
                min={50}
                value={form.monthlyPrice}
                onChange={(e) => update({ monthlyPrice: Math.max(50, Number(e.target.value) || 50) })}
                className="mt-2 text-center text-lg"
              />
            </div>
          </section>
        )}

        {currentStep === 'payment_schedule' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Payment schedule</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">
              How often do you want tenants to pay? Tenants must pay according to your chosen schedule.
            </p>
            <div className="space-y-4 max-w-xl">
              {([
                { value: 'monthly', label: 'Monthly', description: `Pay $${form.monthlyPrice} every month`, multiplier: 1 },
                { value: 'quarterly', label: 'Quarterly', description: `Pay $${form.monthlyPrice * 3} every 3 months`, multiplier: 3 },
                { value: 'biannual', label: 'Biannual', description: `Pay $${form.monthlyPrice * 6} every 6 months`, multiplier: 6 },
                { value: 'annual', label: 'Annual', description: `Pay $${form.monthlyPrice * 12} per year`, multiplier: 12 },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-4 p-4 border-2 rounded-xl cursor-pointer transition-colors ${
                    form.paymentSchedule === opt.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentSchedule"
                    value={opt.value}
                    checked={form.paymentSchedule === opt.value}
                    onChange={() => update({ paymentSchedule: opt.value })}
                    className="w-4 h-4 accent-primary"
                  />
                  <div>
                    <p className="text-xl font-semibold">{opt.label}</p>
                    <p className="text-base text-muted-foreground">{opt.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </section>
        )}

        {currentStep === 'safety' && (
          <section className="max-w-3xl mx-auto py-8">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold mb-3">Share safety details</h2>
            <p className="text-base sm:text-2xl text-muted-foreground mb-8">Does your place have any of these?</p>
            <div className="space-y-6 max-w-2xl">
              {[
                { key: 'exteriorCamera', label: 'Exterior security camera present' },
                { key: 'noiseMonitor', label: 'Noise decibel monitor present' },
                { key: 'weaponsOnProperty', label: 'Weapon(s) on the property' },
              ].map((s) => (
                <div key={s.key} className="flex items-center justify-between">
                  <p className="text-xl sm:text-3xl">{s.label}</p>
                  <Checkbox
                    checked={form[s.key as keyof typeof form] as boolean}
                    onCheckedChange={(checked) => update({ [s.key]: Boolean(checked) } as Partial<typeof form>)}
                  />
                </div>
              ))}
              <div className="pt-4 border-t">
                <Label htmlFor="safety-notes" className="text-xl sm:text-2xl font-medium block mb-2">
                  Additional safety information <span className="text-base font-normal text-muted-foreground">(optional)</span>
                </Label>
                <p className="text-sm text-muted-foreground mb-3">Describe any other safety features, rules, or hazards guests should know about.</p>
                <Textarea
                  id="safety-notes"
                  rows={4}
                  maxLength={300}
                  value={form.safetyNotes}
                  onChange={(e) => update({ safetyNotes: e.target.value })}
                  placeholder="e.g. Pool is unfenced, steep stairs, smoke-free property…"
                />
                <p className="text-sm text-muted-foreground mt-1">{form.safetyNotes.length}/300</p>
              </div>
            </div>
          </section>
        )}

        {currentStep === 'final_details' && (
          <section className="max-w-3xl mx-auto py-8 space-y-6">
            <h2 className="text-3xl sm:text-5xl lg:text-6xl font-semibold">Provide a few final details</h2>
            <p className="text-base sm:text-2xl text-muted-foreground">This is required to help prevent fraud.</p>

            <div className="rounded-2xl border p-5 bg-muted/20">
              <p className="text-base sm:text-2xl text-muted-foreground">Address</p>
              <p className="text-xl sm:text-3xl mt-2">{composedAddress || 'No address yet'}</p>
            </div>

            <div className="rounded-2xl border p-5 bg-muted/20">
              <p className="text-base sm:text-2xl text-muted-foreground">Pricing</p>
              <p className="text-xl sm:text-3xl mt-2">
                {propertyGroup === 'long_term_rental'
                  ? `Monthly rent: $${form.monthlyPrice} · Schedule: ${form.paymentSchedule}`
                  : propertyGroup === 'land' || propertyGroup === 'commercial'
                    ? `Daily rate: $${form.weekdayBasePrice}`
                    : `Weekday: $${form.weekdayBasePrice} · Weekend: $${weekendPrice}`}
              </p>
            </div>

            {propertyGroup === 'hotel' && (
              <div className="rounded-2xl border p-5 bg-muted/20">
                <p className="text-base sm:text-2xl text-muted-foreground">Check-in / Check-out</p>
                <p className="text-xl sm:text-3xl mt-2">Check-in: {form.checkInTime} · Check-out: {form.checkOutTime}</p>
              </div>
            )}

            <div className="rounded-2xl border p-5 bg-muted/20">
              <p className="text-base sm:text-2xl text-muted-foreground">Ready to publish</p>
              <p className="text-xl sm:text-3xl mt-2">
                Your listing has {form.images.length} photos and {form.amenities.length} amenities configured.
                {propertyGroup === 'hotel' && ` ${form.hotelRooms.length} room type${form.hotelRooms.length !== 1 ? 's' : ''} defined.`}
              </p>
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
            ) : currentStep === 'weekend_price' ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={next}>
                  Skip <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button onClick={next} disabled={!canContinue}>
                  Next <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
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
