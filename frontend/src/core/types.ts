// Core type definitions for the application

export interface User {
  id: string;
  username?: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  phone?: string;
  bio?: string;
  isHost: boolean;
  isAdmin?: boolean;
  verified: boolean;
  hasPassword?: boolean;
  lastSeen?: string;
  createdAt: string;
}

export interface Property {
  id: string;
  title: string;
  description: string;
  propertyType: PropertyType;
  category: string;
  images: string[];
  price: number;
  location: Location;
  amenities: Amenity[];
  bedrooms: number;
  beds: number;
  bathrooms: number;
  guests: number;
  hostId: string;
  host: User;
  rating: number;
  reviewCount: number;
  isSuperhost: boolean;
  instantBook: boolean;
  selfCheckin: boolean;
  cancellationPolicy: CancellationPolicy;
  houseRules: string[];
  checkIn: string;
  checkOut: string;
  minNights: number;
  maxNights: number;
  bookedDates: string[];
  createdAt: string;
  status?: 'draft' | 'published';
  hotelRooms?: HotelRoom[];
  // Pricing model: 'monthly' marks a long-term rental (viewing flow available).
  pricingType?: 'nightly' | 'monthly';
  paymentSchedule?: string | null;
}

export interface Location {
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  lat: number;
  lng: number;
}

export interface Amenity {
  id: string;
  name: string;
  icon: string;
  category: string;
}

export interface Review {
  id: string;
  propertyId: string;
  listingTitle?: string;
  userId: string;
  user: User;
  rating: number;
  cleanliness: number;
  accuracy: number;
  checkIn: number;
  communication: number;
  location: number;
  value: number;
  title?: string;
  comment: string;
  response?: string;
  isVerified?: boolean;
  createdAt: string;
}

export interface Booking {
  id: string;
  propertyId: string;
  property: Property;
  userId: string;
  user: User;
  checkIn: string;
  checkOut: string;
  guests: number;
  adults: number;
  children: number;
  infants: number;
  pets: number;
  totalPrice: number;
  basePrice: number;
  cleaningFee: number;
  serviceFee: number;
  taxes: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  specialRequests?: string;
  hotelRoomId?: string;
  hotelRoom?: HotelRoom;
  // Revised booking flow fields
  requiresViewing?: boolean;
  hostConfirmDeadline?: string;
  hostConfirmedAt?: string;
  paymentDueAt?: string;
  daysUntilExpiry?: number;
  createdAt: string;
}

export type ViewingStatus =
  | 'requested'
  | 'fee_paid'
  | 'scheduled'
  | 'completed'
  | 'reserved'
  | 'cancelled'
  | 'expired';

export interface ViewingAppointment {
  id: string;
  listingId: string;
  listingTitle: string;
  viewingDate: string;
  status: ViewingStatus;
  statusDisplay: string;
  viewingFee: number;
  isFeePaid: boolean;
  feePaidAt?: string;
  scheduledAt?: string;
  bookingId?: string;
  createdAt: string;
}

export interface Payout {
  id: string;
  bookingId: string;
  listingTitle: string;
  hostName: string;
  grossAmount: number;
  serviceFeeAmount: number;
  netAmount: number;
  currency: string;
  status: 'pending' | 'paid' | 'cancelled';
  paidAt?: string;
  createdAt: string;
}

export interface HotelRoomImage {
  id: string;
  imageUrl: string;
  caption: string;
  order: number;
}

export interface HotelRoom {
  id: string;
  listingId: string;
  name: string;
  roomType: 'standard' | 'deluxe' | 'suite' | 'family' | 'studio' | 'penthouse';
  description: string;
  pricePerNight: number;
  maxOccupancy: number;
  beds: number;
  bedType: 'king' | 'queen' | 'twin' | 'double' | 'single' | 'bunk';
  bathrooms: number;
  amenities: string[];
  totalCount: number;
  isActive: boolean;
  createdAt: string;
  images: HotelRoomImage[];
}

export interface HotelRoomAvailability extends HotelRoom {
  availableCount: number;
}

export interface MessageAttachment {
  id: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  fileType: 'image' | 'video' | 'document' | 'other';
  createdAt: string;
}

export interface MessageReplySnippet {
  id: string;
  content: string;
  senderName: string;
  messageType: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  sender: User;
  receiverId: string;
  receiver: User;
  content: string;
  messageType: 'text' | 'file' | 'text_file';
  read: boolean;
  editedAt?: string;
  attachments: MessageAttachment[];
  replyTo?: MessageReplySnippet;
  // True when the server stripped a phone number / email out of the content
  // before persisting. Only set on the response from sendMessage.
  wasRedacted?: boolean;
  createdAt: string;
}

export interface Conversation {
  id: string;
  participants: User[];
  lastMessage?: Message;
  unreadCount: number;
  propertyId?: string;
  property?: Property;
  // True only when the two participants share a confirmed/completed booking
  // for this listing. Used to gate the file-upload button in chat.
  attachmentsAllowed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Wishlist {
  id: string;
  userId: string;
  name: string;
  propertyIds: string[];
  properties: Property[];
  isPrivate: boolean;
  createdAt: string;
}

export interface SearchFilters {
  location?: string;
  checkIn?: Date;
  checkOut?: Date;
  guests?: number;
  adults?: number;
  children?: number;
  infants?: number;
  pets?: number;
  priceMin?: number;
  priceMax?: number;
  propertyType?: PropertyType[];
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  amenities?: string[];
  instantBook?: boolean;
  superhost?: boolean;
  categories?: string[];
}

export type PropertyType =
  | 'house'
  | 'apartment'
  | 'villa'
  | 'cabin'
  | 'cottage'
  | 'bungalow'
  | 'chalet'
  | 'treehouse'
  | 'boat'
  | 'castle'
  | 'cave'
  | 'farm'
  | 'room'
  | 'suite'
  | 'hall'
  // Categories from PROPERTY_CATEGORIES that the backend stores as property_type.
  | 'hotels'
  | 'lodge'
  | 'beaches'
  | 'roadside'
  | 'highway'
  | 'land'
  | 'office-space'
  | 'resort'
  | 'land'
  | 'hotel'
  | 'lodge'
  | 'lighthouse'
  | 'yurt';

export type BookingStatus =
  // Revised booking flow
  | 'pending_host'        // reserved free; awaiting host confirmation
  | 'awaiting_payment'    // host confirmed; listing pulled; 10-day pay window
  | 'payment_received'    // guest paid; awaiting admin confirmation
  | 'confirmed'           // admin confirmed; host contact shared
  | 'declined'
  | 'expired_unconfirmed' // host did not confirm in time
  | 'expired_unpaid'      // guest did not pay in time; listing relisted
  | 'cancelled'
  | 'completed'
  // Legacy (kept so old rows/UI still resolve)
  | 'pending';

export type PaymentStatus = 
  | 'pending' 
  | 'paid' 
  | 'refunded' 
  | 'failed';

export type PaymentMethod = 
  | 'stripe' 
  | 'paypal' 
  | 'mtn_momo';

export type CancellationPolicy = 
  | 'flexible' 
  | 'moderate' 
  | 'strict' 
  | 'super_strict';

export interface HostStats {
  totalEarnings: number;
  monthlyEarnings: number;
  totalBookings: number;
  activeListings: number;
  averageRating: number;
  responseRate: number;
  acceptanceRate: number;
  upcomingBookings: Booking[];
  recentReviews: Review[];
}

export interface UserStats {
  totalTrips: number;
  upcomingTrips: number;
  pastTrips: number;
  wishlists: number;
  reviews: number;
}
