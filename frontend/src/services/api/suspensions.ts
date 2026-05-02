import { fetchWithAuth } from './shared/client';

export const suspensionsAPI = {
  list: async (): Promise<any> => {
    return fetchWithAuth('/api/suspensions/');
  },

  create: async (payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth('/api/suspensions/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getById: async (id: string): Promise<any> => {
    return fetchWithAuth(`/api/suspensions/${id}/`);
  },

  revoke: async (id: string, payload: Record<string, any> = {}): Promise<any> => {
    return fetchWithAuth(`/api/suspensions/${id}/revoke/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getUserHistory: async (userId: string): Promise<any> => {
    return fetchWithAuth(`/api/suspensions/user/${userId}/`);
  },

  stats: async (): Promise<any> => {
    return fetchWithAuth('/api/suspensions/stats/');
  },
};