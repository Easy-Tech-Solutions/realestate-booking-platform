import type { DashboardResponse } from './shared/contracts';
import type { Wishlist } from '../../core/types';
import { fetchWithAuth } from './shared/client';

export const wishlistsAPI = {
  getUserWishlists: async (): Promise<Wishlist[]> => {
    return fetchWithAuth<DashboardResponse>('/api/users/me/dashboard/').then((data) =>
      (data.favorites || []).map((favorite) => ({
        id: String(favorite.id),
        userId: '',
        name: 'Saved listing',
        propertyIds: favorite.listing
          ? [String((favorite.listing as { id?: string | number }).id || '')].filter(Boolean)
          : [],
        properties: [],
        isPrivate: false,
        createdAt: favorite.created_at,
      }))
    );
  },
};