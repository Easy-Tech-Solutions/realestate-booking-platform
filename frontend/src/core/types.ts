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
  createdAt: string;
}

export interface Conversation {
  id: string;
  participants: User[];
  lastMessage?: Message;
  unreadCount: number;
  propertyId?: string;
  property?: Property;
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
  | 'resort'
  | 'land'
  | 'hotel'
  | 'lodge'
  | 'lighthouse'
  | 'yurt';

export type BookingStatus = 
  | 'pending' 
  | 'confirmed' 
  | 'cancelled' 
  | 'completed';

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
