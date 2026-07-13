import { fetchWithAuth } from './shared/client';
import { normalizeUser } from './shared/normalizers';
import type { User } from '../../core/types';

export interface SuperadminMe {
  is_full_admin: boolean;
  departments: string[];
  all_departments: string[];
  mfa_enabled: boolean;
}

export interface MfaSetupResponse {
  secret: string;
  otpauth_url: string;
  qr_code_base64: string;
}

export interface AuditLogEntry {
  id: number;
  actor: number | null;
  actor_username: string | null;
  actor_email: string | null;
  action: string;
  target_type: string;
  target_id: string;
  target_repr: string;
  reason: string;
  ip_address: string | null;
  user_agent: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AuditLogPage {
  count: number;
  page: number;
  page_size: number;
  results: AuditLogEntry[];
}

export const superadminAPI = {
  getMe: (): Promise<SuperadminMe> => fetchWithAuth('/api/superadmin/me/'),

  mfaSetup: (): Promise<MfaSetupResponse> =>
    fetchWithAuth('/api/superadmin/mfa/setup/', { method: 'POST' }),

  mfaConfirm: (code: string): Promise<{ backup_codes: string[] }> =>
    fetchWithAuth('/api/superadmin/mfa/confirm/', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  mfaDisable: (code: string): Promise<{ message: string }> =>
    fetchWithAuth('/api/superadmin/mfa/disable/', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  getAuditLog: (params: { page?: number; action?: string; target_type?: string } = {}): Promise<AuditLogPage> => {
    const qs = new URLSearchParams();
    if (params.page) qs.set('page', String(params.page));
    if (params.action) qs.set('action', params.action);
    if (params.target_type) qs.set('target_type', params.target_type);
    const query = qs.toString();
    return fetchWithAuth(`/api/superadmin/audit-log/${query ? `?${query}` : ''}`);
  },

  impersonateStart: async (userId: string, reason: string): Promise<{ access: string; user: User; session_id: number }> => {
    const data = await fetchWithAuth<{ access: string; user: unknown; session_id: number }>(
      `/api/superadmin/impersonate/${userId}/start/`,
      { method: 'POST', body: JSON.stringify({ reason }) },
    );
    return { access: data.access, user: normalizeUser(data.user), session_id: data.session_id };
  },

  impersonateStop: (sessionId: number): Promise<{ message: string }> =>
    fetchWithAuth('/api/superadmin/impersonate/stop/', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    }),
};
