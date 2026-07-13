import { fetchWithAuth } from './shared/client';

export const reportsAPI = {
  listMine: async (): Promise<any> => {
    return fetchWithAuth('/api/reports/');
  },

  create: async (payload: Record<string, any>, screenshot?: File): Promise<any> => {
    const form = new FormData();
    for (const [key, val] of Object.entries(payload)) {
      if (val !== undefined && val !== null) form.append(key, String(val));
    }
    if (screenshot) form.append('screenshot', screenshot);
    return fetchWithAuth('/api/reports/', {
      method: 'POST',
      body: form,
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

  adminEscalate: async (id: string, notes = ''): Promise<any> => {
    return fetchWithAuth(`/api/reports/admin/${id}/escalate/`, {
      method: 'POST',
      body: JSON.stringify({ notes }),
    });
  },

  adminBulkAction: async (payload: { report_ids: number[]; status: 'resolved' | 'dismissed' | 'under_review'; admin_notes?: string }): Promise<{ succeeded: number[]; failed: { report_id: number; error: string }[] }> => {
    return fetchWithAuth('/api/reports/admin/bulk/', { method: 'POST', body: JSON.stringify(payload) });
  },
};