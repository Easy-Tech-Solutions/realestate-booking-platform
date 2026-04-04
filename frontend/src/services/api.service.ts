import { API_BASE_URL } from '../core/constants';
import type { User, Property, Booking, Review, Message, Conversation, Wishlist, SearchFilters, HostStats, UserStats } from '../core/types';

// ─── Token storage ────────────────────────────────────────────────────────────
let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');

export const setTokens = (access: string, refresh: string) => {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
};

export const clearTokens = () => {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
};

export const getAccessToken = () => accessToken;

// ─── Token refresh ────────────────────────────────────────────────────────────
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return null;
    }
    const data = await res.json();
    accessToken = data.access;
    localStorage.setItem('accessToken', data.access);
    return data.access;
  } catch {
    clearTokens();
    return null;
  }
}

// ─── Base fetch with auth + auto-refresh ─────────────────────────────────────
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<any> {
  const makeRequest = async (token: string | null) => {
    const headers: Record<string, string> = {
      ...(!(options.body instanceof FormData) && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(options.headers as Record<string, string>),
    };
    return fetch(`${API_BASE_URL}${url}`, { ...options, headers });
  };

  let response = await makeRequest(accessToken);

  if (response.status === 401 && refreshToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      response = await makeRequest(newToken);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }

  if (response.status === 204) return null;
  return response.json();
}

// ─── Auth API ─────────────────────────────────────────────────────────────────
export const authAPI = {
  login: async (username: string, password: string): Promise<{ user: User; access: string; refresh: string }> => {
    const data = await fetchWithAuth('/api/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setTokens(data.access, data.refresh);
    return { user: normalizeUser(data.user), access: data.access, refresh: data.refresh };
  },

  register: async (data: {
    username: string;
    email: string;
    password: string;
    password2: string;
    first_name?: string;
    last_name?: string;
  }): Promise<{ message: string }> => {
    return fetchWithAuth('/api/auth/register/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    return fetchWithAuth('/api/auth/verify-email/', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  logout: async (): Promise<void> => {
    if (refreshToken) {
      await fetchWithAuth('/api/auth/logout/', {
        method: 'POST',
        body: JSON.stringify({ refresh: refreshToken }),
      }).catch(() => {});
    }
    clearTokens();
  },

  getCurrentUser: async (): Promise<User> => {
    const data = await fetchWithAuth('/api/auth/me/');
    return normalizeUser(data);
  },

  passwordResetRequest: async (email: string): Promise<{ message: string }> => {
    return fetchWithAuth('/api/auth/password-reset/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  passwordResetConfirm: async (token: string, password: string, password2: string): Promise<{ message: string }> => {
    return fetchWithAuth('/api/auth/password-reset-confirm/', {
      method: 'POST',
      body: JSON.stringify({ token, password, password2 }),
    });
  },
};

// ─── Properties API ───────────────────────────────────────────────────────────
export const propertiesAPI = {
  search: async (filters: SearchFilters): Promise<Property[]> => {
    const params = buildSearchParams(filters);
    const data = await fetchWithAuth(`/api/listings/?${params}`);
    return data.map(normalizeListing);
  },

  getById: async (id: string): Promise<Property> => {
    const data = await fetchWithAuth(`/api/listings/${id}/`);
    return normalizeListing(data);
  },

  getFeatured: async (): Promise<Property[]> => {
    const data = await fetchWithAuth('/api/listings/analytics/popular/');
    return (data.popular_listings || []).map(normalizeListing);
  },

  getByCategory: async (category: string): Promise<Property[]> => {
    const data = await fetchWithAuth(`/api/listings/?property_type=${category}`);
    return data.map(normalizeListing);
  },

  create: async (formData: FormData): Promise<Property> => {
    const data = await fetchWithAuth('/api/listings/', {
      method: 'POST',
      body: formData,
    });
    return normalizeListing(data);
  },

  update: async (id: string, formData: FormData): Promise<Property> => {
    const data = await fetchWithAuth(`/api/listings/${id}/`, {
      method: 'PUT',
      body: formData,
    });
    return normalizeListing(data);
  },

  delete: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/listings/${id}/`, { method: 'DELETE' });
  },

  getReviews: async (id: string): Promise<Review[]> => {
    const data = await fetchWithAuth(`/api/listings/${id}/reviews/`);
    return data.map(normalizeReview);
  },

  toggleFavorite: async (id: string, isFavorited: boolean): Promise<void> => {
    await fetchWithAuth(`/api/listings/${id}/favorite/`, {
      method: isFavorited ? 'DELETE' : 'POST',
    });
  },

  getFavorites: async (): Promise<Property[]> => {
    const data = await fetchWithAuth('/api/listings/favorites/');
    return data.map((f: any) => normalizeListing(f.listing));
  },
};

// ─── Bookings API ─────────────────────────────────────────────────────────────
export const bookingsAPI = {
  create: async (bookingData: { listing: string; start_date: string; end_date: string; notes?: string }): Promise<Booking> => {
    const data = await fetchWithAuth('/api/bookings/', {
      method: 'POST',
      body: JSON.stringify(bookingData),
    });
    return normalizeBooking(data);
  },

  getById: async (id: string): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/${id}/`);
    return normalizeBooking(data);
  },

  getUserBookings: async (): Promise<Booking[]> => {
    const data = await fetchWithAuth('/api/bookings/');
    return data.map(normalizeBooking);
  },

  cancel: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/bookings/${id}/`, { method: 'DELETE' });
  },

  confirm: async (id: string): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/${id}/confirm/`, { method: 'POST' });
    return normalizeBooking(data);
  },

  decline: async (id: string, reason?: string): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/${id}/decline/`, {
      method: 'POST',
      body: JSON.stringify({ decline_reason: reason || '' }),
    });
    return normalizeBooking(data);
  },

  getPending: async (): Promise<Booking[]> => {
    const data = await fetchWithAuth('/api/bookings/pending/');
    return data.map(normalizeBooking);
  },
};

// ─── Reviews API ──────────────────────────────────────────────────────────────
export const reviewsAPI = {
  create: async (reviewData: { listing: string; rating: number; title?: string; content: string }): Promise<Review> => {
    const data = await fetchWithAuth('/api/listings/reviews/create/', {
      method: 'POST',
      body: JSON.stringify(reviewData),
    });
    return normalizeReview(data);
  },

  getByProperty: async (propertyId: string): Promise<Review[]> => {
    const data = await fetchWithAuth(`/api/listings/${propertyId}/reviews/`);
    return data.map(normalizeReview);
  },

  delete: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/listings/reviews/${id}/`, { method: 'DELETE' });
  },
};

// ─── Messages API ─────────────────────────────────────────────────────────────
export const messagesAPI = {
  getConversations: async (): Promise<Conversation[]> => {
    return fetchWithAuth('/api/messaging/conversations/');
  },

  getMessages: async (conversationId: string): Promise<Message[]> => {
    return fetchWithAuth(`/api/messaging/conversations/${conversationId}/messages/`);
  },

  sendMessage: async (conversationId: string, content: string): Promise<Message> => {
    return fetchWithAuth(`/api/messaging/conversations/${conversationId}/messages/send/`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  startConversation: async (recipientId: string, content: string, listingId?: string): Promise<Conversation> => {
    return fetchWithAuth('/api/messaging/conversations/start/', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: recipientId, content, listing_id: listingId }),
    });
  },
};

// ─── Wishlists API ────────────────────────────────────────────────────────────
export const wishlistsAPI = {
  getUserWishlists: async (): Promise<Wishlist[]> => {
    return fetchWithAuth('/api/users/me/dashboard/').then(d => d.favorites || []);
  },
};

// ─── Dashboard API ────────────────────────────────────────────────────────────
export const dashboardAPI = {
  getMyDashboard: async () => {
    return fetchWithAuth('/api/users/me/dashboard/');
  },

  getAgentAnalytics: async (days = 30): Promise<HostStats> => {
    const data = await fetchWithAuth(`/api/listings/analytics/agent/?days=${days}`);
    return {
      totalEarnings: parseFloat(data.summary?.total_revenue || '0'),
      monthlyEarnings: 0,
      totalBookings: data.summary?.total_bookings || 0,
      activeListings: data.summary?.total_listings || 0,
      averageRating: 0,
      responseRate: 0,
      acceptanceRate: 0,
      upcomingBookings: [],
      recentReviews: [],
    };
  },
};

// ─── Payments API ─────────────────────────────────────────────────────────────
export const paymentAPI = {
  initiateMomoPayment: async (bookingId: string, phoneNumber: string): Promise<{ payment_id: string; status: string }> => {
    return fetchWithAuth('/api/payments/initiate/', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId, phone_number: phoneNumber, gateway: 'mtn_momo' }),
    });
  },

  checkPaymentStatus: async (paymentId: string): Promise<{ status: string }> => {
    return fetchWithAuth(`/api/payments/${paymentId}/`);
  },
};

// ─── Notifications API ────────────────────────────────────────────────────────
export const notificationsAPI = {
  getAll: async () => {
    return fetchWithAuth('/api/notifications/');
  },

  markRead: async (id: string) => {
    return fetchWithAuth(`/api/notifications/${id}/read/`, { method: 'POST' });
  },

  markAllRead: async () => {
    return fetchWithAuth('/api/notifications/read-all/', { method: 'POST' });
  },
};

// ─── Normalizers (backend snake_case → frontend camelCase) ───────────────────
function normalizeUser(u: any): User {
  return {
    id: String(u.id),
    email: u.email,
    firstName: u.first_name || '',
    lastName: u.last_name || '',
    avatar: u.profile?.image || undefined,
    bio: u.profile?.bio || undefined,
    isHost: u.role === 'agent' || u.role === 'admin',
    isAdmin: u.role === 'admin',
    verified: u.email_verified ?? false,
    createdAt: u.date_joined || new Date().toISOString(),
  };
}

function normalizeListing(l: any): Property {
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
      city: l.address || '',
      state: '',
      country: '',
      zipCode: '',
      lat: 0,
      lng: 0,
    },
    amenities: [],
    bedrooms: l.bedrooms || 0,
    beds: l.bedrooms || 0,
    bathrooms: 0,
    guests: 0,
    hostId: String(l.owner_id || ''),
    host: {
      id: String(l.owner_id || ''),
      email: '',
      firstName: l.owner_username || '',
      lastName: '',
      isHost: true,
      verified: true,
      createdAt: l.created_at,
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
    createdAt: l.created_at,
  };
}

function normalizeBooking(b: any): Booking {
  return {
    id: String(b.id),
    propertyId: String(b.listing),
    property: {} as Property,
    userId: String(b.customer),
    user: {} as User,
    checkIn: b.start_date,
    checkOut: b.end_date,
    guests: 1,
    adults: 1,
    children: 0,
    infants: 0,
    pets: 0,
    totalPrice: 0,
    basePrice: 0,
    cleaningFee: 0,
    serviceFee: 0,
    taxes: 0,
    status: b.status as any,
    paymentStatus: 'pending' as any,
    paymentMethod: 'stripe' as any,
    specialRequests: b.notes,
    createdAt: b.requested_at,
  };
}

function normalizeReview(r: any): Review {
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
    rating: r.rating,
    cleanliness: r.rating,
    accuracy: r.rating,
    checkIn: r.rating,
    communication: r.rating,
    location: r.rating,
    value: r.rating,
    comment: r.content,
    createdAt: r.created_at,
  };
}

function buildSearchParams(filters: SearchFilters): string {
  const params = new URLSearchParams();
  if (filters.location) params.set('address', filters.location);
  if (filters.priceMin) params.set('min_price', String(filters.priceMin));
  if (filters.priceMax) params.set('max_price', String(filters.priceMax));
  if (filters.bedrooms) params.set('min_bedrooms', String(filters.bedrooms));
  if (filters.propertyType?.length) params.set('property_type', filters.propertyType[0]);
  return params.toString();
}
