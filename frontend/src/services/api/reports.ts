import { fetchWithAuth } from './shared/client';

export const reportsAPI = {
  listMine: async (): Promise<any> => {
    return fetchWithAuth('/api/reports/');
  },

  create: async (payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth('/api/reports/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getById: async (id: string): Promise<any> => {
    return fetchWithAuth(`/api/reports/${id}/`);
  },

  listAdmin: async (): Promise<any> => {
    return fetchWithAuth('/api/reports/admin/');
  },

  adminStats: async (): Promise<any> => {
    return fetchWithAuth('/api/reports/admin/stats/');
  },

  adminUpdateStatus: async (id: string, payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth(`/api/reports/admin/${id}/status/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};