import { fetchWithAuth } from './shared/client';

export interface LeaseAgreement {
  id: number;
  booking: number;
  version: string;
  document_url: string | null;
  landlord_name: string;
  tenant_name: string;
  property_address: string;
  rent_display: string;
  lease_start: string | null;
  lease_end: string | null;
  is_accepted: boolean;
  accepted_at: string | null;
  generated_at: string;
}

export const leaseAgreementsAPI = {
  /** The Agreement of Lease for a booking (tenant or owner), or null if none (short-term). */
  getForBooking: async (bookingId: number | string): Promise<LeaseAgreement | null> => {
    const res = await fetchWithAuth<LeaseAgreement | null>(
      `/api/lease-agreements/for-booking/${bookingId}/`,
    );
    return res || null;
  },

  /** Tenant records acceptance of the Agreement of Lease (before payment). */
  accept: async (bookingId: number | string): Promise<LeaseAgreement> => {
    return fetchWithAuth<LeaseAgreement>(`/api/lease-agreements/${bookingId}/accept/`, {
      method: 'POST',
    });
  },
};
