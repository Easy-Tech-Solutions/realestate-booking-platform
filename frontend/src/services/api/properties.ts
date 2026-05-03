import type { Property, Review, SearchFilters } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { buildSearchParams, normalizeListing, normalizeReview } from './shared/normalizers';
import type { AvailabilityResponse, ListingPricingResponse } from './shared/contracts';

export const propertiesAPI = {
  getAll: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<unknown>('/api/listings/?ordering=-created_at');
    const results = Array.isArray(data) ? data : (data as any).results || [];
    return results.map(normalizeListing);
  },

  search: async (filters: SearchFilters): Promise<Property[]> => {
    const params = buildSearchParams(filters);
    const data = await fetchWithAuth<unknown>(`/api/listings/?${params}`);
    const results = Array.isArray(data) ? data : (data as any).results || [];
    return results.map(normalizeListing);
  },

  getById: async (id: string): Promise<Property> => {
    const data = await fetchWithAuth(`/api/listings/${id}/`);
    return normalizeListing(data);
  },

  getFeatured: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<{ popular_listings?: unknown[] }>('/api/listings/analytics/popular/');
    const popularListings = (data.popular_listings || []).map(normalizeListing);

    if (popularListings.length > 0) {
      return popularListings;
    }

    const fallback = await fetchWithAuth<unknown[]>('/api/listings/');
    return fallback.map(normalizeListing);
  },

  getByCategory: async (category: string): Promise<Property[]> => {
    const data = await fetchWithAuth<unknown[]>(`/api/listings/?property_type=${category}`);
    return data.map(normalizeListing);
  },

  listCategories: async (): Promise<Array<{ id: number; name: string; slug: string; is_active: boolean; sort_order: number }>> => {
    return fetchWithAuth('/api/listings/categories/');
  },

  createCategory: async (payload: { name: string; slug: string; is_active?: boolean; sort_order?: number }) => {
    return fetchWithAuth('/api/listings/categories/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateCategory: async (id: number, payload: Partial<{ name: string; slug: string; is_active: boolean; sort_order: number }>) => {
    return fetchWithAuth(`/api/listings/categories/${id}/`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteCategory: async (id: number): Promise<void> => {
    await fetchWithAuth(`/api/listings/categories/${id}/`, { method: 'DELETE' });
  },

  create: async (formData: FormData): Promise<Property> => {
    const data = await fetchWithAuth('/api/listings/', {
      method: 'POST',
      body: formData,
    });
    return normalizeListing(data);
  },

  addGalleryImage: async (listingId: string, file: File, caption = '', order = 0): Promise<any> => {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('caption', caption);
    formData.append('order', String(order));
    return fetchWithAuth(`/api/listings/${listingId}/images/`, {
      method: 'POST',
      body: formData,
    });
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
    const data = await fetchWithAuth<unknown[]>(`/api/listings/${id}/reviews/`);
    return data.map(normalizeReview);
  },

  toggleFavorite: async (id: string, isFavorited: boolean): Promise<void> => {
    await fetchWithAuth(`/api/listings/${id}/favorite/`, {
      method: isFavorited ? 'DELETE' : 'POST',
    });
  },

  getFavorites: async (): Promise<Property[]> => {
    const data = await fetchWithAuth<Array<{ listing: unknown }>>('/api/listings/favorites/');
    return data.map((favorite: any) => normalizeListing(favorite.listing));
  },

  getAvailability: async (id: string): Promise<string[]> => {
    const data = await fetchWithAuth<AvailabilityResponse>(`/api/listings/${id}/availability/`);
    return data.booked_dates || [];
  },

  calculatePricing: async (id: string, startDate: string, endDate: string): Promise<{
    nights: number;
    subtotal: number;
    discount: number;
    discountLabel: string | null;
    discountedSubtotal: number;
    cleaningFee: number;
    serviceFee: number;
    taxes: number;
    total: number;
  }> => {
    const data = await fetchWithAuth<ListingPricingResponse>(
      `/api/listings/${id}/pricing/?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}`
    );
    return {
      nights: data.nights,
      subtotal: data.subtotal,
      discount: data.discount,
      discountLabel: data.discount_label,
      discountedSubtotal: data.discounted_subtotal,
      cleaningFee: data.cleaning_fee,
      serviceFee: data.service_fee,
      taxes: data.taxes,
      total: data.total,
    };
  },

  getByHost: async (hostId: string): Promise<Property[]> => {
    const data = await fetchWithAuth<unknown[]>(`/api/listings/?owner_id=${encodeURIComponent(hostId)}`);
    return data.map(normalizeListing);
  },

  getFullDetails: async (id: string): Promise<any> => {
    return fetchWithAuth(`/api/listings/${id}/`);
  },

  getPlatformStats: async (): Promise<{ total_properties: number; total_locations: number; happy_guests: number }> => {
    return fetchWithAuth('/api/listings/analytics/platform-stats/');
  },
};
