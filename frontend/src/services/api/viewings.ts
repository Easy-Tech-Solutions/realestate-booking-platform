import type { Booking, ViewingAppointment } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { normalizeBooking, normalizeViewing } from './shared/normalizers';

export const viewingsAPI = {
  // Next available Saturday slots for a listing (one slot per property/Saturday).
  getSlots: async (listingId: string): Promise<string[]> => {
    const data = await fetchWithAuth<{ available_saturdays: string[] }>(
      `/api/bookings/viewings/slots/${listingId}/`
    );
    return data.available_saturdays || [];
  },

  // The requester's viewing appointments.
  getMine: async (): Promise<ViewingAppointment[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/bookings/viewings/');
    return data.map(normalizeViewing);
  },

  // Request a viewing on a chosen Saturday (creates the appointment; the $3 fee
  // is paid separately via the payments API).
  request: async (payload: {
    listing: string;
    viewing_date: string;
    viewing_time: string; // 'HH:MM' — one of the six 2-hour start blocks
    guest_notes?: string;
  }): Promise<ViewingAppointment> => {
    const data = await fetchWithAuth('/api/bookings/viewings/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizeViewing(data);
  },

  // After a completed viewing: "Reserve Property" → creates an awaiting_payment booking.
  reserve: async (
    viewingId: string,
    payload: { start_date: string; end_date: string }
  ): Promise<Booking> => {
    const data = await fetchWithAuth(`/api/bookings/viewings/${viewingId}/reserve/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizeBooking(data);
  },

  // Admin: every viewing request across all guests/listings, optionally filtered by status.
  adminGetAll: async (statusFilter?: string): Promise<ViewingAppointment[]> => {
    const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
    const data = await fetchWithAuth<unknown[]>(`/api/bookings/viewings/admin/${qs}`);
    return data.map(normalizeViewing);
  },

  // Admin: schedule, complete, or cancel a viewing request.
  adminUpdateStatus: async (
    viewingId: string,
    payload: { status: 'scheduled' | 'completed' | 'cancelled'; admin_notes?: string }
  ): Promise<ViewingAppointment> => {
    const data = await fetchWithAuth(`/api/bookings/viewings/admin/${viewingId}/status/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return normalizeViewing(data);
  },
};
