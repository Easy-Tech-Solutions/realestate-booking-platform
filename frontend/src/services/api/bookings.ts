import type { Booking } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { normalizeBooking } from './shared/normalizers';

export const bookingsAPI = {
  create: async (bookingData: { listing: string; start_date: string; end_date: string; notes?: string }): Promise<Booking> => {
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

  getPending: async (): Promise<Booking[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/bookings/pending/');
    return data.map(normalizeBooking);
  },
};