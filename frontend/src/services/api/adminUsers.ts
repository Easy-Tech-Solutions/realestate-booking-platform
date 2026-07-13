import { fetchWithAuth } from './shared/client';

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  is_staff: boolean;
  is_superuser: boolean;
  is_active: boolean;
  email_verified: boolean;
  is_archived: boolean;
  deleted_at: string | null;
  date_joined: string;
  momo_number: string;
  has_password: boolean;
  generated_password?: string;
}

export interface AdminUserListParams {
  search?: string;
  role?: string;
  is_active?: boolean;
  is_staff?: boolean;
  page?: number;
  page_size?: number;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface BulkActionResult {
  succeeded: number[];
  failed: { user_id: number; error: string }[];
}

export interface HardDeleteBlockedResponse {
  error: string;
  protected_records: Record<string, number>;
  hint: string;
}

function buildQuery(params: AdminUserListParams): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const adminUsersAPI = {
  list: async (params: AdminUserListParams = {}): Promise<PaginatedResponse<AdminUser>> => {
    return fetchWithAuth(`/api/users/admin/list/${buildQuery(params)}`);
  },

  get: async (id: number): Promise<AdminUser> => {
    return fetchWithAuth(`/api/users/admin/${id}/`);
  },

  create: async (payload: {
    username: string; email: string; first_name?: string; last_name?: string;
    role: 'user' | 'agent'; password?: string; reason?: string;
  }): Promise<AdminUser> => {
    return fetchWithAuth('/api/users/admin/create/', { method: 'POST', body: JSON.stringify(payload) });
  },

  update: async (id: number, payload: { first_name?: string; last_name?: string; role?: 'user' | 'agent' | 'admin'; reason?: string }): Promise<AdminUser> => {
    return fetchWithAuth(`/api/users/admin/${id}/update/`, { method: 'PATCH', body: JSON.stringify(payload) });
  },

  changeEmail: async (id: number, email: string, reason?: string): Promise<AdminUser> => {
    return fetchWithAuth(`/api/users/admin/${id}/email/`, { method: 'PATCH', body: JSON.stringify({ email, reason }) });
  },

  resetPassword: async (id: number, password: string, reason?: string): Promise<{ message: string }> => {
    return fetchWithAuth(`/api/users/admin/${id}/reset-password/`, { method: 'POST', body: JSON.stringify({ password, reason }) });
  },

  toggleActive: async (id: number, is_active: boolean, reason?: string): Promise<AdminUser> => {
    return fetchWithAuth(`/api/users/admin/${id}/toggle-active/`, { method: 'POST', body: JSON.stringify({ is_active, reason }) });
  },

  softDelete: async (id: number, reason: string): Promise<{ message: string }> => {
    return fetchWithAuth(`/api/users/admin/${id}/soft-delete/`, { method: 'POST', body: JSON.stringify({ reason }) });
  },

  hardDelete: async (id: number, reason: string, force = false): Promise<{ message?: string; pending_approval?: boolean; approval_id?: number }> => {
    return fetchWithAuth(`/api/users/admin/${id}/hard-delete/`, { method: 'POST', body: JSON.stringify({ reason, force }) });
  },

  bulkAction: async (payload: { action: string; user_ids: number[]; role_id?: number; reason?: string }): Promise<BulkActionResult> => {
    return fetchWithAuth('/api/users/admin/bulk/', { method: 'POST', body: JSON.stringify(payload) });
  },
};
