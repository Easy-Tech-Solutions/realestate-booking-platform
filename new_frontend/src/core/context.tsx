import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { User, SearchFilters, Property } from './types';
import { authAPI } from '../services/api.service';

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: any) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  searchFilters: SearchFilters;
  setSearchFilters: (filters: SearchFilters) => void;
  wishlistIds: string[];
  toggleWishlist: (propertyId: string) => void;
  isLoading: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({});
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    const token = localStorage.getItem('authToken');
    if (token) {
      authAPI.getCurrentUser()
        .then(setUser)
        .catch(() => authAPI.logout())
        .finally(() => setIsLoading(false));
    } else {
      // For development: set a default mock user
      setUser({
        id: '1',
        email: 'user@example.com',
        firstName: 'John',
        lastName: 'Doe',
        avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
        isHost: true,
        isAdmin: false,
        verified: true,
        createdAt: new Date().toISOString(),
      });
      setIsLoading(false);
    }

    // Load wishlist from localStorage
    const savedWishlist = localStorage.getItem('wishlist');
    if (savedWishlist) {
      setWishlistIds(JSON.parse(savedWishlist));
    }
  }, []);

  const login = async (email: string, password: string) => {
    const { user, token } = await authAPI.login(email, password);
    setUser(user);
  };

  const register = async (data: any) => {
    const { user, token } = await authAPI.register(data);
    setUser(user);
  };

  const loginWithGoogle = async () => {
    const { user, token } = await authAPI.loginWithGoogle();
    setUser(user);
  };

  const logout = () => {
    authAPI.logout();
    setUser(null);
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

  return (
    <AppContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated: !!user,
        login,
        register,
        loginWithGoogle,
        logout,
        searchFilters,
        setSearchFilters,
        wishlistIds,
        toggleWishlist,
        isLoading,
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
