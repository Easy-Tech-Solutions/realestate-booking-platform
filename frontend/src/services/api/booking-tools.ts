import { fetchWithAuth } from './shared/client';

export const bookingToolsAPI = {
  getSavedSearches: async (): Promise<any> => {
    return fetchWithAuth('/api/bookings/searches/');
  },

  createSavedSearch: async (payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth('/api/bookings/searches/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateSavedSearch: async (id: string, payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth(`/api/bookings/searches/${id}/`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteSavedSearch: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/bookings/searches/${id}/`, { method: 'DELETE' });
  },

  getSearchAlerts: async (): Promise<any> => {
    return fetchWithAuth('/api/bookings/searches/alerts/');
  },

  testSearch: async (payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth('/api/bookings/searches/test/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getComparisons: async (): Promise<any> => {
    return fetchWithAuth('/api/bookings/comparisons/');
  },

  createComparison: async (payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth('/api/bookings/comparisons/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateComparison: async (id: string, payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth(`/api/bookings/comparisons/${id}/`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteComparison: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/bookings/comparisons/${id}/`, { method: 'DELETE' });
  },

  getSharedComparison: async (token: string): Promise<any> => {
    return fetchWithAuth(`/api/bookings/comparisons/shared/${token}/`);
  },

  addToComparison: async (comparisonId: string, listingId: string): Promise<any> => {
    return fetchWithAuth('/api/bookings/comparisons/add/', {
      method: 'POST',
      body: JSON.stringify({ comparison_id: comparisonId, listing_id: listingId }),
    });
  },

  removeFromComparison: async (comparisonId: string, listingId: string): Promise<any> => {
    return fetchWithAuth('/api/bookings/comparisons/remove/', {
      method: 'POST',
      body: JSON.stringify({ comparison_id: comparisonId, listing_id: listingId }),
    });
  },
};