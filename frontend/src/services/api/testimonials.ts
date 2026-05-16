import { fetchPublicJson } from './shared/client';

export interface Testimonial {
  id: number;
  name: string;
  location: string;
  rating: number;
  quote: string;
  avatar_color: string;
  avatar_initials: string;
  created_at: string;
}

export const testimonialsAPI = {
  getAll: async (): Promise<Testimonial[]> => {
    return fetchPublicJson('/api/testimonials/');
  },

  create: async (payload: {
    name: string;
    location?: string;
    rating: number;
    quote: string;
  }): Promise<Testimonial> => {
    return fetchPublicJson('/api/testimonials/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
