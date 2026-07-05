import { fetchWithAuth } from './shared/client';

export interface HostApplication {
  id: number;
  full_name: string;
  address: string;
  phone: string;
  email: string;
  headshot_url: string | null;
  id_document_url: string | null;
  status: 'submitted' | 'ps_approved' | 'compliance_approved' | 'approved' | 'declined';
  status_display: string;
  current_stage: string | null;
  declined_stage: string;
  decline_reason: string;
  can_reapply: boolean;
  created_at: string;
  updated_at: string;
}

export const hostApplicationsAPI = {
  /** The current user's latest application, or null if they've never applied. */
  getMine: async (): Promise<HostApplication | null> => {
    const res = await fetchWithAuth<HostApplication | null>('/api/host-applications/me/');
    // A 204 (never applied) resolves to an empty body → normalise to null.
    return res || null;
  },

  /** Submit a new host application (multipart — includes the two photos). */
  create: async (formData: FormData): Promise<HostApplication> => {
    return fetchWithAuth<HostApplication>('/api/host-applications/', {
      method: 'POST',
      body: formData,
    });
  },
};
