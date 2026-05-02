import type { Review } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { normalizeReview } from './shared/normalizers';

export const reviewsAPI = {
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