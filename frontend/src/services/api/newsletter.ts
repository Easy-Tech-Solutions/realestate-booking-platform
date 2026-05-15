import { fetchPublicJson, fetchWithAuth } from './shared/client';

const BASE = '/api/newsletter';

export const newsletterAPI = {
  subscribe: async (payload: {
    email: string;
    first_name?: string;
    interests?: string[];
  }): Promise<{ message: string }> => {
    return fetchPublicJson(`${BASE}/subscribe/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  unsubscribe: async (token: string): Promise<{ message: string }> => {
    return fetchPublicJson(`${BASE}/unsubscribe/`, {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  getSubscribers: async (): Promise<any> => {
    return fetchWithAuth(`${BASE}/subscribers/`);
  },
};
