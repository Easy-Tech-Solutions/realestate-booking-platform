import { fetchWithAuth, getAccessToken } from './shared/client';
import { API_BASE_URL } from '../../core/constants';
import type { PaymentEnvelope } from './shared/contracts';

const initiatePayment = async (payload: {
  booking_id: string;
  phone_number: string;
  gateway?: 'mtn_momo' | 'flutterwave' | 'orange_money';
  payment_method?: string;
  currency?: string;
}): Promise<any> => {
  const data = await fetchWithAuth<PaymentEnvelope>('/api/payments/initiate/', {
    method: 'POST',
    body: JSON.stringify({
      booking_id: payload.booking_id,
      phone_number: payload.phone_number,
      gateway: payload.gateway || 'mtn_momo',
      payment_method: payload.payment_method || 'mobile_money',
      currency: payload.currency || 'USD',
    }),
  });
  return data.payment || data;
};

interface StripeIntentResponse {
  client_secret: string;
  amount_cents: number;
}

// Business Policy §10 — refund eligibility reasons. `change_of_mind` is
// always rejected server-side; `other` is admin-discretion only.
export type RefundReasonCode = 'misrepresentation' | 'legal_issue' | 'safety_concern' | 'change_of_mind' | 'other';

export const REFUND_REASON_OPTIONS: { value: RefundReasonCode; label: string }[] = [
  { value: 'misrepresentation', label: 'Property misrepresentation' },
  { value: 'legal_issue', label: 'Legal issue discovered' },
  { value: 'safety_concern', label: 'Safety concern' },
  { value: 'change_of_mind', label: 'Change of mind (not eligible)' },
  { value: 'other', label: 'Other (admin discretion)' },
];

export interface PlatformFee {
  booking_fee: string;
  viewing_fee: string;
  service_fee_percent: string;
  transaction_fee_type: 'fixed' | 'percentage' | 'range';
  transaction_fee_value: string;
  transaction_fee_min: string | null;
  transaction_fee_max: string | null;
  updated_at: string;
}

export interface EscrowBooking {
  booking_id: number;
  listing_title: string;
  guest_username: string;
  total_price: string | null;
  requested_at: string | null;
  on_hold: boolean;
  hold_id: number | null;
  hold_reason: string;
}

export interface TaxRate {
  id: number;
  jurisdiction: string;
  rate_percent: string;
  is_active: boolean;
  created_by: number | null;
  created_by_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaxReportBucket {
  jurisdiction: string;
  gross_total: string;
  tax_liability: string;
  booking_count: number;
}

export const paymentAPI = {
  initiatePayment,

  // ── Rent / booking payment (after host confirmation) ──────────────────────
  initiateMomoPayment: async (bookingId: string, phoneNumber: string): Promise<any> => {
    return initiatePayment({
      booking_id: bookingId,
      phone_number: phoneNumber,
      gateway: 'mtn_momo',
      payment_method: 'mobile_money',
      currency: 'USD',
    });
  },

  // Stripe PaymentIntent for the rent (amount computed server-side from the booking).
  createBookingPaymentIntent: async (bookingId: string): Promise<StripeIntentResponse> => {
    return fetchWithAuth<StripeIntentResponse>('/api/payments/stripe/booking-payment-intent/', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId, currency: 'usd' }),
    });
  },

  // ── Viewing appointment fee ($3) ──────────────────────────────────────────
  initiateViewingMomoPayment: async (viewingId: string, phoneNumber: string): Promise<any> => {
    const data = await fetchWithAuth<PaymentEnvelope>('/api/payments/viewing/initiate/', {
      method: 'POST',
      body: JSON.stringify({
        viewing_id: viewingId,
        phone_number: phoneNumber,
        gateway: 'mtn_momo',
        payment_method: 'mobile_money',
        currency: 'USD',
      }),
    });
    return data.payment || data;
  },

  // Stripe PaymentIntent for the viewing fee (amount computed server-side).
  createViewingFeeIntent: async (viewingId: string): Promise<StripeIntentResponse> => {
    return fetchWithAuth<StripeIntentResponse>('/api/payments/stripe/viewing-fee-intent/', {
      method: 'POST',
      body: JSON.stringify({ viewing_id: viewingId, currency: 'usd' }),
    });
  },

  checkPaymentStatus: async (paymentId: string): Promise<any> => {
    const data = await fetchWithAuth<PaymentEnvelope>(`/api/payments/${paymentId}/`);
    return data.payment || data;
  },

  verifyPayment: async (paymentId: string, gateway = 'mtn_momo'): Promise<any> => {
    return fetchWithAuth('/api/payments/verify/', {
      method: 'POST',
      body: JSON.stringify({ payment_id: paymentId, gateway }),
    });
  },

  requestRefund: async (paymentId: string, amount: number, reason: string, reasonCode: RefundReasonCode): Promise<any> => {
    return fetchWithAuth('/api/payments/refund/', {
      method: 'POST',
      body: JSON.stringify({ payment_id: paymentId, amount, reason, reason_code: reasonCode }),
    });
  },

  getMyPayments: async (): Promise<any> => {
    return fetchWithAuth('/api/payments/user/');
  },

  // ── Admin: finance ops ────────────────────────────────────────────────────
  adminFinancialSummary: async (params: { since?: string; until?: string } = {}): Promise<any> => {
    const qs = new URLSearchParams();
    if (params.since) qs.set('since', params.since);
    if (params.until) qs.set('until', params.until);
    return fetchWithAuth(`/api/payments/admin/reports/summary/?${qs.toString()}`);
  },

  adminTransactions: async (params: Record<string, string> = {}): Promise<any> => {
    const qs = new URLSearchParams(params);
    return fetchWithAuth(`/api/payments/admin/transactions/?${qs.toString()}`);
  },

  adminExportTransactionsCsv: async (params: Record<string, string> = {}): Promise<void> => {
    const qs = new URLSearchParams(params);
    const response = await fetch(`${API_BASE_URL}/api/payments/admin/transactions/export/?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${getAccessToken() || ''}` },
      credentials: 'include',
    });
    if (!response.ok) throw new Error('Failed to export transactions');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transactions.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },

  adminRefund: async (paymentId: string, amount: number, reason: string, reasonCode: RefundReasonCode): Promise<any> => {
    return fetchWithAuth('/api/payments/admin/refund/', {
      method: 'POST',
      body: JSON.stringify({ payment_id: paymentId, amount, reason, reason_code: reasonCode }),
    });
  },

  adminGetPlatformFee: async (): Promise<PlatformFee> => {
    return fetchWithAuth<PlatformFee>('/api/payments/admin/platform-fee/');
  },

  adminUpdatePlatformFee: async (payload: Partial<PlatformFee>): Promise<PlatformFee> => {
    return fetchWithAuth<PlatformFee>('/api/payments/admin/platform-fee/', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  // ── Escrow ────────────────────────────────────────────────────────────────
  adminListEscrow: async (): Promise<EscrowBooking[]> => {
    return fetchWithAuth<EscrowBooking[]>('/api/payments/admin/escrow/');
  },

  adminHoldEscrow: async (bookingId: number, reason: string): Promise<{ id: number }> => {
    return fetchWithAuth(`/api/payments/admin/escrow/${bookingId}/hold/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  adminReleaseEscrow: async (holdId: number): Promise<{ id: number }> => {
    return fetchWithAuth(`/api/payments/admin/escrow/${holdId}/release/`, { method: 'POST' });
  },

  // ── Tax rates ─────────────────────────────────────────────────────────────
  adminListTaxRates: async (): Promise<TaxRate[]> => {
    return fetchWithAuth<TaxRate[]>('/api/payments/admin/tax-rates/');
  },

  adminCreateTaxRate: async (payload: { jurisdiction: string; rate_percent: string }): Promise<TaxRate> => {
    return fetchWithAuth<TaxRate>('/api/payments/admin/tax-rates/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  adminUpdateTaxRate: async (id: number, payload: Partial<{ rate_percent: string; is_active: boolean }>): Promise<TaxRate> => {
    return fetchWithAuth<TaxRate>(`/api/payments/admin/tax-rates/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  adminDeleteTaxRate: async (id: number): Promise<void> => {
    await fetchWithAuth<void>(`/api/payments/admin/tax-rates/${id}/`, { method: 'DELETE' });
  },

  adminTaxReport: async (since?: string, until?: string): Promise<{ by_jurisdiction: TaxReportBucket[] }> => {
    const qs = new URLSearchParams();
    if (since) qs.set('since', since);
    if (until) qs.set('until', until);
    return fetchWithAuth(`/api/payments/admin/tax-report/?${qs.toString()}`);
  },

  // ── Stripe refunds ────────────────────────────────────────────────────────
  adminStripeRefund: async (bookingId: number, amount: number, reason: string, reasonCode: RefundReasonCode): Promise<{ pending_approval: boolean; approval_id: number; message: string }> => {
    return fetchWithAuth('/api/payments/admin/stripe-refund/', {
      method: 'POST',
      body: JSON.stringify({ booking_id: bookingId, amount, reason, reason_code: reasonCode }),
    });
  },
};

export interface SavedCard {
  id: number;
  cardholder_name: string;
  last4: string;
  card_type: 'visa' | 'mastercard' | 'amex' | 'discover' | 'other';
  card_type_display: string;
  expiry_month: string;
  expiry_year: string;
  is_default: boolean;
  created_at: string;
}

export const cardsAPI = {
  list: (): Promise<SavedCard[]> =>
    fetchWithAuth('/api/payments/cards/'),

  add: (payload: {
    cardholder_name: string;
    last4: string;
    card_type: string;
    expiry_month: string;
    expiry_year: string;
    is_default?: boolean;
  }): Promise<SavedCard> =>
    fetchWithAuth('/api/payments/cards/', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: (id: number, payload: Partial<{
    cardholder_name: string;
    expiry_month: string;
    expiry_year: string;
    is_default: boolean;
  }>): Promise<SavedCard> =>
    fetchWithAuth(`/api/payments/cards/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  remove: (id: number): Promise<void> =>
    fetchWithAuth(`/api/payments/cards/${id}/`, { method: 'DELETE' }),

  setDefault: (id: number): Promise<SavedCard> =>
    fetchWithAuth(`/api/payments/cards/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ is_default: true }),
    }),
};