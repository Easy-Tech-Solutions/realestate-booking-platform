import { API_BASE_URL } from '../core/constants';
import type {
  User,
  Property,
  Booking,
  Review,
  Message,
  Conversation,
  Wishlist,
  SearchFilters,
  HostStats,
  UserStats,
} from '../core/types';

// Mock JWT token storage
let authToken: string | null = localStorage.getItem('authToken');

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
};

export const getAuthToken = () => authToken;

// Base fetch wrapper with auth
async function fetchWithAuth(url: string, options: RequestInit = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(authToken && { Authorization: `Bearer ${authToken}` }),
    ...options.headers,
  };

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

// Authentication API
export const authAPI = {
  login: async (email: string, password: string): Promise<{ user: User; token: string }> => {
    // Mock implementation
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockUser: User = {
          id: '1',
          email,
          firstName: 'John',
          lastName: 'Doe',
          avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
          isHost: true,
          isAdmin: true,
          verified: true,
          createdAt: new Date().toISOString(),
        };
        const token = 'mock-jwt-token-' + Math.random();
        setAuthToken(token);
        resolve({ user: mockUser, token });
      }, 1000);
    });
  },

  register: async (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ user: User; token: string }> => {
    // Mock implementation
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockUser: User = {
          id: Math.random().toString(),
          ...data,
          isHost: false,
          verified: false,
          createdAt: new Date().toISOString(),
        };
        const token = 'mock-jwt-token-' + Math.random();
        setAuthToken(token);
        resolve({ user: mockUser, token });
      }, 1000);
    });
  },

  loginWithGoogle: async (): Promise<{ user: User; token: string }> => {
    // Mock implementation
    return new Promise((resolve) => {
      setTimeout(() => {
        const mockUser: User = {
          id: 'google-' + Math.random(),
          email: 'user@gmail.com',
          firstName: 'Google',
          lastName: 'User',
          avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
          isHost: false,
          verified: true,
          createdAt: new Date().toISOString(),
        };
        const token = 'mock-jwt-token-' + Math.random();
        setAuthToken(token);
        resolve({ user: mockUser, token });
      }, 1000);
    });
  },

  logout: () => {
    setAuthToken(null);
  },

  getCurrentUser: async (): Promise<User> => {
    // Mock implementation
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          id: '1',
          email: 'user@example.com',
          firstName: 'John',
          lastName: 'Doe',
          avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
          isHost: true,
          isAdmin: true,
          verified: true,
          createdAt: new Date().toISOString(),
        });
      }, 500);
    });
  },
};

// Properties API
export const propertiesAPI = {
  search: async (filters: SearchFilters): Promise<Property[]> => {
    const { mockProperties } = await import('./mock-data');
    return new Promise((resolve) => setTimeout(() => resolve(mockProperties), 300));
  },

  getById: async (id: string): Promise<Property> => {
    const { mockProperties } = await import('./mock-data');
    return new Promise((resolve, reject) => setTimeout(() => {
      const p = mockProperties.find(p => p.id === id);
      p ? resolve(p) : reject(new Error('Property not found'));
    }, 300));
  },

  getFeatured: async (): Promise<Property[]> => {
    const { mockProperties } = await import('./mock-data');
    return new Promise((resolve) => setTimeout(() => resolve(mockProperties), 300));
  },

  getByCategory: async (category: string): Promise<Property[]> => {
    const { mockProperties } = await import('./mock-data');
    return new Promise((resolve) => setTimeout(() => resolve(mockProperties.filter(p => p.category === category)), 300));
  },
};

// Bookings API
export const bookingsAPI = {
  create: async (bookingData: Partial<Booking>): Promise<Booking> => {
    return new Promise((resolve) => setTimeout(() => resolve({ id: Math.random().toString(36).slice(2), ...bookingData } as Booking), 500));
  },

  getById: async (id: string): Promise<Booking> => {
    return new Promise((_, reject) => setTimeout(() => reject(new Error('Not implemented in mock')), 300));
  },

  getUserBookings: async (_userId: string): Promise<Booking[]> => {
    return new Promise((resolve) => setTimeout(() => resolve([]), 300));
  },

  cancel: async (id: string): Promise<Booking> => {
    return new Promise((resolve) => setTimeout(() => resolve({ id } as Booking), 300));
  },
};

// Reviews API
export const reviewsAPI = {
  create: async (reviewData: Partial<Review>): Promise<Review> => {
    return new Promise((resolve) => setTimeout(() => resolve({ id: Math.random().toString(36).slice(2), ...reviewData } as Review), 300));
  },

  getByProperty: async (propertyId: string): Promise<Review[]> => {
    const { mockReviews } = await import('./mock-data');
    return new Promise((resolve) => setTimeout(() => resolve(mockReviews.filter(r => r.propertyId === propertyId)), 300));
  },
};

// Messages API
export const messagesAPI = {
  getConversations: async (_userId: string): Promise<Conversation[]> => {
    return new Promise((resolve) => setTimeout(() => resolve([]), 300));
  },

  getMessages: async (_conversationId: string): Promise<Message[]> => {
    return new Promise((resolve) => setTimeout(() => resolve([]), 300));
  },

  sendMessage: async (messageData: Partial<Message>): Promise<Message> => {
    return new Promise((resolve) => setTimeout(() => resolve({ id: Math.random().toString(36).slice(2), ...messageData } as Message), 300));
  },
};

// Wishlists API
export const wishlistsAPI = {
  getUserWishlists: async (_userId: string): Promise<Wishlist[]> => {
    return new Promise((resolve) => setTimeout(() => resolve([]), 300));
  },

  create: async (wishlistData: Partial<Wishlist>): Promise<Wishlist> => {
    return new Promise((resolve) => setTimeout(() => resolve({ id: Math.random().toString(36).slice(2), ...wishlistData } as Wishlist), 300));
  },

  addProperty: async (wishlistId: string, _propertyId: string): Promise<Wishlist> => {
    return new Promise((resolve) => setTimeout(() => resolve({ id: wishlistId } as Wishlist), 300));
  },

  removeProperty: async (wishlistId: string, _propertyId: string): Promise<Wishlist> => {
    return new Promise((resolve) => setTimeout(() => resolve({ id: wishlistId } as Wishlist), 300));
  },
};

// Dashboard API
export const dashboardAPI = {
  getHostStats: async (_userId: string): Promise<HostStats> => {
    return new Promise((resolve) => setTimeout(() => resolve({
      totalEarnings: 29700, monthlyEarnings: 5800, totalBookings: 84,
      activeListings: 6, averageRating: 4.92, responseRate: 98,
      acceptanceRate: 95, upcomingBookings: [], recentReviews: [],
    }), 300));
  },

  getUserStats: async (_userId: string): Promise<UserStats> => {
    return new Promise((resolve) => setTimeout(() => resolve({
      totalTrips: 4, upcomingTrips: 2, pastTrips: 2, wishlists: 3, reviews: 2,
    }), 300));
  },
};

// Payment API
export const paymentAPI = {
  createPaymentIntent: async (_bookingId: string, _method: string): Promise<{ clientSecret: string }> => {
    return new Promise((resolve) => setTimeout(() => resolve({ clientSecret: 'mock_secret_' + Math.random() }), 500));
  },

  confirmPayment: async (_paymentIntentId: string): Promise<{ success: boolean }> => {
    return new Promise((resolve) => setTimeout(() => resolve({ success: true }), 500));
  },
};
