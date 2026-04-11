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