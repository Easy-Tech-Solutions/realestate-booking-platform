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
  // Only present in reviewer-facing responses (review queue / review decision) —
  // never returned to the applicant being assessed.
  ai_risk_score?: number | null;
  ai_rationale?: string;
}

export interface AgreementStatus {
  version: string;
  effective_date: string;
  title: string;
  accepted: boolean;
  accepted_version: string | null;
  accepted_at: string | null;
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

  /** Current Property Owner Agreement version + whether this user has accepted it. */
  agreementStatus: async (): Promise<AgreementStatus> => {
    return fetchWithAuth<AgreementStatus>('/api/host-applications/agreement/');
  },

  /** Record acceptance of the current agreement version (used when re-accepting). */
  acceptAgreement: async (): Promise<AgreementStatus> => {
    return fetchWithAuth<AgreementStatus>('/api/host-applications/agreement/accept/', {
      method: 'POST',
    });
  },

  /** Applications awaiting review at any stage the caller is a reviewer for. */
  reviewQueue: async (): Promise<HostApplication[]> => {
    return fetchWithAuth<HostApplication[]>('/api/host-applications/review-queue/');
  },

  /** Approve or decline at whichever stage this application is currently awaiting. */
  review: async (id: number, approve: boolean, reason = ''): Promise<HostApplication> => {
    return fetchWithAuth<HostApplication>(`/api/host-applications/${id}/review/`, {
      method: 'POST',
      body: JSON.stringify({ approve, reason }),
    });
  },
};
