import { fetchWithAuth } from './shared/client';
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
      payment_method: payload.payment_method || 'momo',
      currency: payload.currency || 'LRD',
    }),
  });
  return data.payment || data;
};

export const paymentAPI = {
  initiatePayment,

  initiateMomoPayment: async (bookingId: string, phoneNumber: string): Promise<any> => {
    return initiatePayment({
      booking_id: bookingId,
      phone_number: phoneNumber,
      gateway: 'mtn_momo',
      payment_method: 'momo',
      currency: 'LRD',
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

  requestRefund: async (paymentId: string, amount: number, reason: string): Promise<any> => {
    return fetchWithAuth('/api/payments/refund/', {
      method: 'POST',
      body: JSON.stringify({ payment_id: paymentId, amount, reason }),
    });
  },

  getMyPayments: async (): Promise<any> => {
    return fetchWithAuth('/api/payments/user/');
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