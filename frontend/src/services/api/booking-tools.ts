import { fetchWithAuth } from './shared/client';

export interface SavedSearch {
  id: number;
  name: string;
  user: number;
  user_username: string;
  min_price: string | null;
  max_price: string | null;
  property_type: string | null;
  min_bedrooms: number | null;
  max_bedrooms: number | null;
  min_square_footage: number | null;
  max_square_footage: number | null;
  address: string;
  keywords: string;
  is_available: boolean;
  email_frequency: 'instantly' | 'daily' | 'weekly';
  email_frequency_display: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  listing_count: number;
}

export interface SearchAlert {
  id: number;
  saved_search: number;
  listing: number;
  listing_title: string;
  listing_price: string;
  listing_address: string;
  listing_image: string | null;
  saved_search_name: string;
  sent_at: string;
}

export interface ComparisonItem {
  id: number;
  listing: Record<string, any>;
  listing_title: string;
  order: number;
  notes: string;
  score: number;
  advantages: string[];
  disadvantages: string[];
}

export interface PropertyComparison {
  id: number;
  name: string;
  user: number;
  user_username: string;
  items: ComparisonItem[];
  total_properties: number;
  share_url: string | null;
  average_price: string | null;
  average_bedrooms: number | null;
  average_square_footage: number | null;
  is_public: boolean;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export const bookingToolsAPI = {
  getSavedSearches: async (): Promise<SavedSearch[]> => {
    return fetchWithAuth('/api/bookings/searches/');
  },

  createSavedSearch: async (payload: Record<string, any>): Promise<SavedSearch> => {
    return fetchWithAuth('/api/bookings/searches/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSavedSearch: async (id: string, payload: Record<string, any>): Promise<SavedSearch> => {
    return fetchWithAuth(`/api/bookings/searches/${id}/`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteSavedSearch: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/bookings/searches/${id}/`, { method: 'DELETE' });
  },

  getSearchAlerts: async (): Promise<SearchAlert[]> => {
    return fetchWithAuth('/api/bookings/searches/alerts/');
  },

  testSearch: async (payload: Record<string, any>): Promise<any[]> => {
    return fetchWithAuth('/api/bookings/searches/test/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getComparisons: async (): Promise<PropertyComparison[]> => {
    return fetchWithAuth('/api/bookings/comparisons/');
  },

  createComparison: async (payload: Record<string, any>): Promise<PropertyComparison> => {
    return fetchWithAuth('/api/bookings/comparisons/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateComparison: async (id: string, payload: Record<string, any>): Promise<PropertyComparison> => {
    return fetchWithAuth(`/api/bookings/comparisons/${id}/`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteComparison: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/bookings/comparisons/${id}/`, { method: 'DELETE' });
  },

  getSharedComparison: async (token: string): Promise<PropertyComparison> => {
    return fetchWithAuth(`/api/bookings/comparisons/shared/${token}/`);
  },

  addToComparison: async (comparisonId: string, listingId: string): Promise<PropertyComparison> => {
    return fetchWithAuth('/api/bookings/comparisons/add/', {
      method: 'POST',
      body: JSON.stringify({ comparison_id: comparisonId, listing_id: listingId }),
    });
  },

  removeFromComparison: async (comparisonId: string, listingId: string): Promise<PropertyComparison> => {
    return fetchWithAuth('/api/bookings/comparisons/remove/', {
      method: 'POST',
      body: JSON.stringify({ comparison_id: comparisonId, listing_id: listingId }),
    });
  },
};
