import type { Payout } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { normalizePayout } from './shared/normalizers';

export const payoutsAPI = {
  // Admin: all host payouts, optionally filtered by status.
  adminList: async (status?: 'pending' | 'paid' | 'cancelled'): Promise<Payout[]> => {
    const qs = status ? `?status=${status}` : '';
    const data = await fetchWithAuth<unknown[]>(`/api/payments/admin/payouts/${qs}`);
    return data.map(normalizePayout);
  },

  // Admin: mark a payout as paid (optionally with a disbursement reference).
  adminMarkPaid: async (id: string, reference?: string): Promise<Payout> => {
    const data = await fetchWithAuth(`/api/payments/admin/payouts/${id}/mark-paid/`, {
      method: 'POST',
      body: JSON.stringify({ reference: reference || '' }),
    });
    return normalizePayout(data);
  },

  // Admin: cancel a pending payout (only allowed before it's been paid).
  adminCancel: async (id: string, reason: string): Promise<Payout> => {
    const data = await fetchWithAuth(`/api/payments/admin/payouts/${id}/cancel/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    return normalizePayout(data);
  },
};
