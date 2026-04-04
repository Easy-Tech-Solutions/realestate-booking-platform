import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User, SearchFilters, Booking } from './types';
import { authAPI, setTokens, clearTokens, getAccessToken } from '../services/api.service';

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (data: {
    username: string;
    email: string;
    password: string;
    password2: string;
    first_name?: string;
    last_name?: string;
  }) => Promise<{ message: string }>;
  logout: () => Promise<void>;
  searchFilters: SearchFilters;
  setSearchFilters: (filters: SearchFilters) => void;
  wishlistIds: string[];
  toggleWishlist: (propertyId: string) => void;
  isLoading: boolean;
  bookings: Booking[];
  addBooking: (booking: Booking) => void;
  cancelBooking: (bookingId: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({});
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    const token = getAccessToken();
    if (token) {
      authAPI.getCurrentUser()
        .then(setUser)
        .catch(() => clearTokens())
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }

    const savedWishlist = localStorage.getItem('wishlist');
    if (savedWishlist) {
      try {
        setWishlistIds(JSON.parse(savedWishlist));
      } catch {}
    }
  }, []);

  const login = async (username: string, password: string) => {
    const { user } = await authAPI.login(username, password);
    setUser(user);
  };

  const register = async (data: {
    username: string;
    email: string;
    password: string;
    password2: string;
    first_name?: string;
    last_name?: string;
  }) => {
    return authAPI.register(data);
  };

  const logout = async () => {
    await authAPI.logout();
    setUser(null);
    setBookings([]);
  };

  const toggleWishlist = (propertyId: string) => {
    setWishlistIds((prev) => {
      const newWishlist = prev.includes(propertyId)
        ? prev.filter((id) => id !== propertyId)
        : [...prev, propertyId];
      localStorage.setItem('wishlist', JSON.stringify(newWishlist));
      return newWishlist;
    });
  };

  const addBooking = (booking: Booking) => {
    setBookings(prev => [booking, ...prev]);
  };

  const cancelBooking = (bookingId: string) => {
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'cancelled' as const } : b));
  };

  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        searchFilters,
        setSearchFilters,
        wishlistIds,
        toggleWishlist,
        isLoading,
        bookings,
        addBooking,
        cancelBooking,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
