import { fetchWithAuth } from './shared/client';

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface GenericListParams {
  search?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  [filterKey: string]: string | number | boolean | undefined;
}

function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const genericAdminAPI = {
  list: <T,>(modelKey: string, params: GenericListParams = {}): Promise<PaginatedResponse<T>> =>
    fetchWithAuth(`/api/superadmin/generic/${modelKey}/${buildQuery(params)}`),

  get: <T,>(modelKey: string, id: number): Promise<T> =>
    fetchWithAuth(`/api/superadmin/generic/${modelKey}/${id}/`),

  create: <T,>(modelKey: string, payload: Record<string, unknown>): Promise<T> =>
    fetchWithAuth(`/api/superadmin/generic/${modelKey}/`, { method: 'POST', body: JSON.stringify(payload) }),

  update: <T,>(modelKey: string, id: number, payload: Record<string, unknown>): Promise<T> =>
    fetchWithAuth(`/api/superadmin/generic/${modelKey}/${id}/`, { method: 'PATCH', body: JSON.stringify(payload) }),

  remove: (modelKey: string, id: number): Promise<void> =>
    fetchWithAuth(`/api/superadmin/generic/${modelKey}/${id}/`, { method: 'DELETE' }),
};
