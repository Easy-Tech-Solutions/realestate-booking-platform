import { fetchWithAuth } from './shared/client';

export interface AgentCommission {
  id: number;
  booking_id: number;
  listing_title: string;
  agent_name: string;
  agent_id: number;
  booking_amount: string;
  amount: string;
  currency: string;
  status: 'pending' | 'paid' | 'voided';
  reference: string;
  paid_at: string | null;
  voided_at: string | null;
  created_at: string;
}

export const agentCommissionsAPI = {
  // Admin: all sourcing-agent commissions, optionally filtered by status.
  adminList: (status?: 'pending' | 'paid' | 'voided'): Promise<AgentCommission[]> => {
    const qs = status ? `?status=${status}` : '';
    return fetchWithAuth(`/api/payments/admin/agent-commissions/${qs}`);
  },

  // Admin: pay a pending commission via a live MTN MoMo disbursement.
  adminDisburse: (id: number): Promise<AgentCommission> =>
    fetchWithAuth(`/api/payments/admin/agent-commissions/${id}/disburse/`, { method: 'POST' }),
};
