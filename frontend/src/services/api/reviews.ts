import type { Review } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { normalizeReview } from './shared/normalizers';

export const reviewsAPI = {
  getAll: async (params?: {
    page?: number;
    minRating?: number;
    ordering?: '-created_at' | 'created_at' | '-rating' | 'rating';
    listingId?: string;
  }): Promise<{ count: number; next: string | null; previous: string | null; results: Review[] }> => {
    const q = new URLSearchParams();
    if (params?.page && params.page > 1) q.set('page', String(params.page));
    if (params?.minRating) q.set('min_rating', String(params.minRating));
    if (params?.ordering) q.set('ordering', params.ordering);
    if (params?.listingId) q.set('listing_id', params.listingId);
    const url = `/api/listings/reviews/${q.toString() ? `?${q}` : ''}`;
    const data = await fetchWithAuth<any>(url);
    return {
      count: data.count ?? 0,
      next: data.next ?? null,
      previous: data.previous ?? null,
      results: (data.results ?? []).map(normalizeReview),
    };
  },

  create: async (reviewData: {
    listing: string;
    rating: number;
    title?: string;
    content: string;
    cleanliness?: number;
    accuracy?: number;
    check_in_rating?: number;
    communication?: number;
    location_rating?: number;
    value?: number;
  }): Promise<Review> => {
    const data = await fetchWithAuth('/api/listings/reviews/create/', {
      method: 'POST',
      body: JSON.stringify(reviewData),
    });
    return normalizeReview(data);
  },

  getByProperty: async (propertyId: string): Promise<Review[]> => {
    const data = await fetchWithAuth<unknown[]>(`/api/listings/${propertyId}/reviews/`);
    return data.map(normalizeReview);
  },

  delete: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/listings/reviews/${id}/`, { method: 'DELETE' });
  },

  respond: async (id: string, response: string): Promise<Review> => {
    const data = await fetchWithAuth(`/api/listings/reviews/${id}/respond/`, {
      method: 'POST',
      body: JSON.stringify({ response }),
    });
    return normalizeReview(data);
  },
};