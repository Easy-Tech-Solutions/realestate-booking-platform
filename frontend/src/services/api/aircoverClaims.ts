import { fetchWithAuth } from './shared/client';

export interface AirCoverClaim {
  id: number;
  booking: number;
  listing_title: string;
  claimant: number;
  claimant_username: string;
  claim_type: 'property_damage' | 'missing_items' | 'cleanliness' | 'safety' | 'other';
  claim_type_display: string;
  description: string;
  requested_amount: string;
  approved_amount: string | null;
  status: 'submitted' | 'under_review' | 'approved' | 'denied' | 'paid';
  status_display: string;
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  review_notes: string;
  reviewed_at: string | null;
  created_at: string;
}

export const aircoverClaimsAPI = {
  listMine: async (): Promise<AirCoverClaim[]> => {
    return fetchWithAuth<AirCoverClaim[]>('/api/support/aircover-claims/');
  },

  file: async (payload: { booking: number; claim_type: string; description: string; requested_amount: string }): Promise<AirCoverClaim> => {
    return fetchWithAuth<AirCoverClaim>('/api/support/aircover-claims/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  adminList: async (statusFilter?: string): Promise<AirCoverClaim[]> => {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    return fetchWithAuth<AirCoverClaim[]>(`/api/support/admin/aircover-claims/${qs}`);
  },

  adminDecide: async (id: number, decision: 'approved' | 'denied', notes = '', approvedAmount?: string): Promise<AirCoverClaim> => {
    return fetchWithAuth<AirCoverClaim>(`/api/support/admin/aircover-claims/${id}/decide/`, {
      method: 'POST',
      body: JSON.stringify({ status: decision, notes, ...(approvedAmount ? { approved_amount: approvedAmount } : {}) }),
    });
  },
};
