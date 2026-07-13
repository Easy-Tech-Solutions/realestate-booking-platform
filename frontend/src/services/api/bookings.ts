import type { Booking, Payout } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { normalizeBooking, normalizePayout } from './shared/normalizers';

export const bookingsAPI = {
  create: async (bookingData: { listing: string; start_date: string; end_date: string; notes?: string; hotel_room?: string; stripe_payment_intent_id?: string; payment_method?: 'stripe' | 'mtn_momo' }): Promise<Booking> => {
    const data = await fetchWithAuth('/api/bookings/', {
      method: 'POST',
      body: JSON.stringify(bookingData),
    });
    return normalizeBooking(data);
  },

  getById: async (id: string): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/${id}/`);
    return normalizeBooking(data);
  },

  getUserBookings: async (): Promise<Booking[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/bookings/');
    return data.map(normalizeBooking);
  },

  cancel: async (id: string): Promise<void> => {
    await fetchWithAuth(`/api/bookings/${id}/`, { method: 'DELETE' });
  },

  confirm: async (id: string): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/${id}/confirm/`, { method: 'POST' });
    return normalizeBooking(data);
  },

  decline: async (id: string, reason?: string): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/${id}/decline/`, {
      method: 'POST',
      body: JSON.stringify({ decline_reason: reason || '' }),
    });
    return normalizeBooking(data);
  },

  // Admin-only: confirm a received payment → finalizes the booking, shares host
  // contact, and creates the host payout.
  confirmPayment: async (id: string): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/${id}/confirm-payment/`, { method: 'POST' });
    return normalizeBooking(data);
  },

  getPending: async (): Promise<Booking[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/bookings/pending/');
    return data.map(normalizeBooking);
  },

  // Admin: bookings whose payment is awaiting confirmation.
  getPaymentReceived: async (): Promise<Booking[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/bookings/admin/payment-received/');
    return data.map(normalizeBooking);
  },

  // Host: my payout records.
  getMyPayouts: async (): Promise<Payout[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/bookings/payouts/');
    return data.map(normalizePayout);
  },

  // Admin: the guest<->host message thread(s) tied to a booking's listing.
  adminGetCommunications: async (id: string | number): Promise<{
    booking_id: number; guest_username: string; host_username: string; conversation_count: number;
    messages: { id: number; conversation_id: number; sender_id: number; sender_username: string; content: string; message_type: string; created_at: string }[];
  }> => {
    return fetchWithAuth(`/api/bookings/admin/${id}/communications/`);
  },
};