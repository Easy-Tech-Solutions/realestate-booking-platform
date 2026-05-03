import { AMENITIES } from '../../../core/constants';
import type { Booking, Conversation, Message, Property, Review, SearchFilters, User } from '../../../core/types';

export function normalizeUser(u: any): User {
  const firstName = u.first_name || u.full_name?.split(' ')[0] || u.username || u.email?.split('@')[0] || '';
  const lastName = u.last_name || u.full_name?.split(' ').slice(1).join(' ') || '';

  return {
    id: String(u.id),
    username: u.username,
    email: u.email,
    firstName,
    lastName,
    avatar: u.profile?.image || undefined,
    bio: u.profile?.bio || undefined,
    isHost: u.role === 'agent' || u.role === 'admin',
    isAdmin: u.role === 'admin',
    verified: u.email_verified ?? false,
    createdAt: u.date_joined || new Date().toISOString(),
  };
}

export function normalizeListing(l: any): Property {
  const amenities = normalizeAmenities(l.amenities);
  const locationParts = String(l.address || '').split(',').map((part) => part.trim()).filter(Boolean);

  return {
    id: String(l.id),
    title: l.title,
    description: l.description || '',
    propertyType: l.property_type as any,
    category: l.property_type,
    images: [
      ...(l.main_image_url ? [l.main_image_url] : []),
      ...(l.gallery_images || []).map((img: any) => img.image_url || img.image),
    ],
    price: parseFloat(l.price) || 0,
    location: {
      address: l.address || '',
      city: l.city || locationParts[0] || '',
      state: l.state || locationParts[1] || '',
      country: l.country || locationParts[2] || '',
      zipCode: '',
      lat: parseFloat(l.latitude || l.lat || 0) || 0,
      lng: parseFloat(l.longitude || l.lng || 0) || 0,
    },
    amenities,
    bedrooms: l.bedrooms || 0,
    beds: l.beds || 0,
    bathrooms: l.bathrooms || 0,
    guests: l.max_guests || 0,
    hostId: String(l.owner_id || ''),
    host: {
      id: String(l.owner_id || ''),
      email: '',
      firstName: l.owner_first_name || l.owner_username || '',
      lastName: l.owner_last_name || '',
      avatar: l.owner_avatar || undefined,
      isHost: true,
      verified: true,
      createdAt: l.created_at,
    },
    rating: Number(l.average_rating || 0),
    reviewCount: Number(l.review_count || 0),
    isSuperhost: Boolean(l.owner_is_superhost),
    instantBook: l.booking_mode === 'instant',
    selfCheckin: Boolean(l.self_checkin),
    cancellationPolicy: l.cancellation_policy || 'flexible',
    houseRules: buildHouseRules(l),
    checkIn: l.check_in_time || '15:00',
    checkOut: l.check_out_time || '11:00',
    minNights: 1,
    maxNights: 365,
    bookedDates: [],
    createdAt: l.created_at,
  };
}

export function normalizeBooking(b: any): Booking {
  const statusMap: Record<string, Booking['status']> = {
    requested: 'pending',
    confirmed: 'confirmed',
    cancelled: 'cancelled',
    completed: 'completed',
  };

  const fallbackProperty: Property = {
    id: String(b.listing),
    title: b.listing_title || 'Property',
    description: '',
    propertyType: 'apartment',
    category: 'apartment',
    images: [],
    price: Number(b.price || 0),
    location: {
      address: '',
      city: '',
      state: '',
      country: '',
      zipCode: '',
      lat: 0,
      lng: 0,
    },
    amenities: [],
    bedrooms: 0,
    beds: 0,
    bathrooms: 0,
    guests: Number(b.guest_count || 1),
    hostId: '',
    host: {
      id: '',
      email: '',
      firstName: b.listing_owner || 'Host',
      lastName: '',
      isHost: true,
      verified: true,
      createdAt: b.requested_at || new Date().toISOString(),
    },
    rating: 0,
    reviewCount: 0,
    isSuperhost: false,
    instantBook: false,
    cancellationPolicy: 'flexible',
    houseRules: [],
    checkIn: '15:00',
    checkOut: '11:00',
    minNights: 1,
    maxNights: 365,
    bookedDates: [],
    createdAt: b.requested_at || new Date().toISOString(),
  };

  const fallbackUser: User = {
    id: String(b.customer || ''),
    email: '',
    firstName: b.customer_username || 'Guest',
    lastName: '',
    isHost: false,
    verified: true,
    createdAt: b.requested_at || new Date().toISOString(),
  };

  return {
    id: String(b.id),
    propertyId: String(b.listing),
    property: fallbackProperty,
    userId: String(b.customer),
    user: fallbackUser,
    checkIn: b.start_date,
    checkOut: b.end_date,
    guests: Number(b.guest_count || 1),
    adults: Number(b.guest_count || 1),
    children: 0,
    infants: 0,
    pets: 0,
    totalPrice: Number(b.total_price || 0),
    basePrice: Number(b.base_price || 0),
    cleaningFee: 0,
    serviceFee: 0,
    taxes: 0,
    status: statusMap[b.status] || 'pending',
    paymentStatus: 'pending' as const,
    paymentMethod: 'stripe' as const,
    specialRequests: b.notes,
    createdAt: b.requested_at,
  };
}

export function normalizeReview(r: any): Review {
  return {
    id: String(r.id),
    propertyId: String(r.listing),
    userId: String(r.reviewer),
    user: {
      id: String(r.reviewer),
      email: '',
      firstName: r.reviewer_username || '',
      lastName: '',
      avatar: r.reviewer_avatar,
      isHost: false,
      verified: true,
      createdAt: r.created_at,
    },
    rating: Number(r.rating || 0),
    cleanliness: Number(r.cleanliness || r.rating || 0),
    accuracy: Number(r.accuracy || r.rating || 0),
    checkIn: Number(r.check_in_rating || r.rating || 0),
    communication: Number(r.communication || r.rating || 0),
    location: Number(r.location_rating || r.rating || 0),
    value: Number(r.value || r.rating || 0),
    comment: r.content,
    response: r.host_response || undefined,
    createdAt: r.created_at,
  };
}

export function normalizeConversation(conversation: any): Conversation {
  return {
    id: String(conversation.id),
    participants: (conversation.participants || []).map(normalizeUser),
    lastMessage: conversation.last_message
      ? {
          id: String(conversation.last_message.id),
          conversationId: String(conversation.id),
          senderId: String(conversation.last_message.sender_id || ''),
          sender: {
            id: String(conversation.last_message.sender_id || ''),
            email: conversation.last_message.sender_email || '',
            firstName: conversation.last_message.sender_email?.split('@')[0] || 'User',
            lastName: '',
            isHost: false,
            verified: true,
            createdAt: conversation.last_message.created_at,
          },
          receiverId: '',
          receiver: {
            id: '',
            email: '',
            firstName: '',
            lastName: '',
            isHost: false,
            verified: true,
            createdAt: conversation.last_message.created_at,
          },
          content: conversation.last_message.content || '',
          read: conversation.unread_count === 0,
          createdAt: conversation.last_message.created_at,
        }
      : undefined,
    unreadCount: Number(conversation.unread_count || 0),
    propertyId: conversation.listing ? String(conversation.listing) : undefined,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  };
}

export function normalizeMessage(message: any): Message {
  const sender = normalizeUser(message.sender || {});

  return {
    id: String(message.id),
    conversationId: String(message.conversation),
    senderId: sender.id,
    sender,
    receiverId: '',
    receiver: {
      id: '',
      email: '',
      firstName: '',
      lastName: '',
      isHost: false,
      verified: true,
      createdAt: message.created_at,
    },
    content: message.content || '',
    read: Boolean(message.is_read),
    createdAt: message.created_at,
  };
}

export function buildSearchParams(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.location) params.set('address', filters.location);
  if (filters.priceMin) params.set('min_price', String(filters.priceMin));
  if (filters.priceMax) params.set('max_price', String(filters.priceMax));
  if (filters.bedrooms) params.set('min_bedrooms', String(filters.bedrooms));
  if (filters.propertyType?.length) params.set('property_type', filters.propertyType[0]);
  return params.toString();
}

function normalizeAmenities(value: any): Property['amenities'] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item: any) => {
    const amenityId = String(item).toLowerCase().replace(/\s+/g, '-');
    const existing = AMENITIES.find((amenity) => amenity.id === amenityId || amenity.name.toLowerCase() === String(item).toLowerCase());
    return existing || {
      id: amenityId,
      name: String(item),
      icon: 'Check',
      category: 'General',
    };
  });
}

function buildHouseRules(listing: any): string[] {
  const rules: string[] = [];
  if (listing.exterior_camera) rules.push('Exterior security camera on property');
  if (listing.noise_monitor) rules.push('Noise monitoring device on property');
  if (listing.weapons_on_property) rules.push('Weapons are present on the property');
  return rules;
}