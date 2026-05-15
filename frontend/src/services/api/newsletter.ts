import { fetchWithAuth } from './shared/client';

const BASE = '/api/newsletter';

export const newsletterAPI = {
  subscribe: async (payload: {
    email: string;
    first_name?: string;
    interests?: string[];
  }): Promise<{ message: string }> => {
    const res = await fetch(`${BASE}/subscribe/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.email?.[0] || data.error || 'Subscription failed');
    return data;
  },

  unsubscribe: async (token: string): Promise<{ message: string }> => {
    const res = await fetch(`${BASE}/unsubscribe/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to unsubscribe');
    return data;
  },

  getSubscribers: async (): Promise<any> => {
    return fetchWithAuth(`${BASE}/subscribers/`);
  },
};
