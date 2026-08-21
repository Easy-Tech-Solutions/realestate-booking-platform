import { fetchWithAuth } from './shared/client';

export interface AgentApplication {
  id: number;
  full_name: string;
  address: string;
  phone: string;
  email: string;
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

export interface AgentApplicationState {
  is_agent: boolean;
  application: AgentApplication | null;
}

export interface AgentDashboard {
  is_agent: boolean;
  summary: {
    properties_sourced: number;
    published: number;
    in_review: number;
    total_bookings: number;
    commission_pending: string;
    commission_paid: string;
    commission_total: string;
  };
  sourced_properties: Array<{
    id: number; title: string; listing_status: string;
    verification_status: string | null; created_at: string;
  }>;
  commissions: Array<{
    id: number; booking_id: number; listing_title: string | null;
    amount: string; currency: string; status: string; created_at: string;
  }>;
}

export const agentsAPI = {
  /** My agent-application state (+ whether I'm an approved agent). */
  getMyApplication: async (): Promise<AgentApplicationState> => {
    return fetchWithAuth<AgentApplicationState>('/api/agents/applications/me/');
  },

  /** Apply to become a sourcing agent (multipart — includes the ID photo). */
  apply: async (formData: FormData): Promise<AgentApplication> => {
    return fetchWithAuth<AgentApplication>('/api/agents/applications/', {
      method: 'POST', body: formData,
    });
  },

  /** Read-only agent dashboard (sourced properties, bookings, commissions). */
  dashboard: async (): Promise<AgentDashboard> => {
    return fetchWithAuth<AgentDashboard>('/api/agents/dashboard/');
  },

  /** Submit a property on an owner's behalf (multipart — listing fields + owner details). */
  listProperty: async (formData: FormData): Promise<unknown> => {
    return fetchWithAuth('/api/agents/list-property/', { method: 'POST', body: formData });
  },
};
