import { fetchWithAuth } from './shared/client';

export const suspensionsAPI = {
  list: async (params: { status?: string; suspension_type?: string; user_id?: string; limit?: number; offset?: number } = {}): Promise<any> => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.suspension_type) qs.set('suspension_type', params.suspension_type);
    if (params.user_id) qs.set('user_id', params.user_id);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const suffix = qs.toString();
    return fetchWithAuth(`/api/suspensions/${suffix ? `?${suffix}` : ''}`);
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