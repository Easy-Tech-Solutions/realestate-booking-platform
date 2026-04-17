// Application constants

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';

export const PROPERTY_CATEGORIES = [
  { id: 'house', name: 'Houses', icon: '🏠' },
  { id: 'apartment', name: 'Apartments', icon: '🏢' },
  { id: 'villa', name: 'Villas', icon: '🌴' },
  { id: 'cabin', name: 'Cabins', icon: '🏕️' },
  { id: 'cottage', name: 'Cottages', icon: '🌿' },
  { id: 'bungalow', name: 'Bungalows', icon: '🛖' },
  { id: 'chalet', name: 'Chalets', icon: '🏔️' },
  { id: 'treehouse', name: 'Treehouses', icon: '🌳' },
  { id: 'boat', name: 'Boats', icon: '⛵' },
  { id: 'castle', name: 'Castles', icon: '🏰' },
  { id: 'cave', name: 'Caves', icon: '🪨' },
  { id: 'farm', name: 'Farms', icon: '🚜' },
];

export const AMENITIES = [
  { id: 'wifi', name: 'Wifi', icon: 'Wifi', category: 'Basic' },
  { id: 'kitchen', name: 'Kitchen', icon: 'ChefHat', category: 'Basic' },
  { id: 'washer', name: 'Washer', icon: 'WashingMachine', category: 'Basic' },
  { id: 'dryer', name: 'Dryer', icon: 'Wind', category: 'Basic' },
  { id: 'ac', name: 'Air conditioning', icon: 'AirVent', category: 'Basic' },
  { id: 'heating', name: 'Heating', icon: 'Flame', category: 'Basic' },
  { id: 'tv', name: 'TV', icon: 'Tv', category: 'Entertainment' },
  { id: 'pool', name: 'Pool', icon: 'Waves', category: 'Outdoor' },
  { id: 'hot-tub', name: 'Hot tub', icon: 'Bath', category: 'Outdoor' },
  { id: 'gym', name: 'Gym', icon: 'Dumbbell', category: 'Facilities' },
  { id: 'parking', name: 'Free parking', icon: 'ParkingSquare', category: 'Basic' },
  { id: 'ev-charger', name: 'EV charger', icon: 'Zap', category: 'Parking' },
  { id: 'workspace', name: 'Dedicated workspace', icon: 'Laptop', category: 'Work' },
  { id: 'bbq', name: 'BBQ grill', icon: 'Flame', category: 'Outdoor' },
  { id: 'fireplace', name: 'Fireplace', icon: 'Flame', category: 'Indoor' },
  { id: 'piano', name: 'Piano', icon: 'Music', category: 'Entertainment' },
  { id: 'beach-access', name: 'Beach access', icon: 'Waves', category: 'Location' },
  { id: 'pets', name: 'Pets allowed', icon: 'Dog', category: 'Policies' },
  { id: 'smoke-alarm', name: 'Smoke alarm', icon: 'AlertCircle', category: 'Safety' },
  { id: 'first-aid', name: 'First aid kit', icon: 'HeartPulse', category: 'Safety' },
];

export const PROPERTY_TYPES = [
  { id: 'house', name: 'House' },
  { id: 'apartment', name: 'Apartment' },
  { id: 'villa', name: 'Villa' },
  { id: 'cabin', name: 'Cabin' },
  { id: 'cottage', name: 'Cottage' },
  { id: 'bungalow', name: 'Bungalow' },
  { id: 'chalet', name: 'Chalet' },
  { id: 'treehouse', name: 'Treehouse' },
  { id: 'boat', name: 'Boat' },
  { id: 'castle', name: 'Castle' },
  { id: 'cave', name: 'Cave' },
  { id: 'farm', name: 'Farm' },
];

export const CANCELLATION_POLICIES = {
  flexible: {
    name: 'Flexible',
    description: 'Full refund 1 day prior to arrival',
    details: 'Cancel up to 24 hours before check-in for a full refund.',
  },
  moderate: {
    name: 'Moderate',
    description: 'Full refund 5 days prior to arrival',
    details: 'Cancel up to 5 days before check-in for a full refund.',
  },
  strict: {
    name: 'Strict',
    description: 'Full refund 14 days prior to arrival',
    details: 'Cancel up to 14 days before check-in for a full refund.',
  },
  super_strict: {
    name: 'Super Strict',
    description: 'Full refund 30 days prior to arrival',
    details: 'Cancel up to 30 days before check-in for a full refund.',
  },
};

export const PAYMENT_METHODS = [
  { id: 'stripe', name: 'Credit/Debit Card', icon: 'CreditCard', provider: 'Stripe' },
  { id: 'paypal', name: 'PayPal', icon: 'Wallet', provider: 'PayPal' },
  { id: 'mtn_momo', name: 'MTN Mobile Money', icon: 'Smartphone', provider: 'MTN' },
];
