import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { toast } from 'sonner';
import type { User, SearchFilters } from '../core/types';
import { authAPI, propertiesAPI, clearTokens, getAccessToken } from '../services/api.service';
import { queryClient } from '../providers/QueryProvider';
import { queryKeys } from '../hooks/queries/keys';

export interface AppStoreState {
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
  }) => Promise<{ message: string; verification_url?: string; verification_token?: string }>;
  logout: () => Promise<void>;
  searchFilters: SearchFilters;
  setSearchFilters: (filters: SearchFilters) => void;
  wishlistIds: string[];
  toggleWishlist: (propertyId: string) => void;
  isLoading: boolean;
  initialize: () => Promise<void>;
}

export const useAppStore = create<AppStoreState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      searchFilters: {},
      wishlistIds: [],

      setUser: (user) => set({ user, isAuthenticated: Boolean(user) }),

      login: async (username, password) => {
        const { user } = await authAPI.login(username, password);
        set({ user, isAuthenticated: true });
        loadFavoritesIntoStore();
      },

      register: async (data) => authAPI.register(data),

      logout: async () => {
        await authAPI.logout();
        set({ user: null, isAuthenticated: false, wishlistIds: [] });
        queryClient.removeQueries({ queryKey: queryKeys.properties.favorites });
      },

      setSearchFilters: (filters) => set({ searchFilters: filters }),

      toggleWishlist: (propertyId) => {
        const prev = get().wishlistIds;
        const wasFavorited = prev.includes(propertyId);
        const next = wasFavorited
          ? prev.filter((id) => id !== propertyId)
          : [...prev, propertyId];
        set({ wishlistIds: next });

        if (!get().isAuthenticated) return;

        propertiesAPI
          .toggleFavorite(propertyId, wasFavorited)
          .then(() => {
            queryClient.invalidateQueries({ queryKey: queryKeys.properties.favorites });
          })
          .catch(() => {
            const current = get().wishlistIds;
            const rolledBack = wasFavorited
              ? (current.includes(propertyId) ? current : [...current, propertyId])
              : current.filter((id) => id !== propertyId);
            set({ wishlistIds: rolledBack });
            toast.error('Failed to update favorites. Please try again.');
          });
      },

      initialize: async () => {
        const token = getAccessToken();
        if (!token) {
          set({ user: null, isAuthenticated: false, isLoading: false });
          return;
        }

        set({ isLoading: true });
        try {
          const user = await authAPI.getCurrentUser();
          set({ user, isAuthenticated: true, isLoading: false });
          loadFavoritesIntoStore();
        } catch {
          clearTokens();
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      },
    }),
    {
      name: 'easy-tech-app-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        searchFilters: state.searchFilters,
        wishlistIds: state.wishlistIds,
      }),
    }
  )
);

function loadFavoritesIntoStore() {
  propertiesAPI
    .getFavorites()
    .then((favorites) => {
      useAppStore.setState({ wishlistIds: favorites.map((p) => p.id) });
    })
    .catch(() => {
      // best-effort sync; keep local state if the server is unreachable
    });
}
