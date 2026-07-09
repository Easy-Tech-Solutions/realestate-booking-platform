import { fetchWithAuth } from './shared/client';

export type VerificationStatus =
  | 'submitted' | 'ps_approved' | 'compliance_approved'
  | 'approved' | 'rejected' | 'correction_requested';

export interface PropertyVerification {
  id: number;
  listing: number;
  listing_title: string;
  ownership_type: 'owner' | 'non_owner';
  owner_name: string;
  property_location: string;
  deed_volume_number: string;
  mou_document_url: string | null;
  status: VerificationStatus;
  status_display: string;
  current_stage: string | null;
  outcome_stage: string;
  review_notes: string;
  can_resubmit: boolean;
  resubmission_count: number;
  created_at: string;
  updated_at: string;
}

export const propertyVerificationsAPI = {
  /** Submit a freshly created listing for verification (multipart — may include MOU). */
  create: async (formData: FormData): Promise<PropertyVerification> => {
    return fetchWithAuth<PropertyVerification>('/api/property-verifications/', {
      method: 'POST',
      body: formData,
    });
  },

  /** The verification for one of my listings, or null if none. */
  getForListing: async (listingId: number | string): Promise<PropertyVerification | null> => {
    const res = await fetchWithAuth<PropertyVerification | null>(
      `/api/property-verifications/for-listing/${listingId}/`,
    );
    return res || null;
  },

  /** Resubmit after a correction request (optionally with updated fields). */
  resubmit: async (id: number | string, formData: FormData): Promise<PropertyVerification> => {
    return fetchWithAuth<PropertyVerification>(`/api/property-verifications/${id}/resubmit/`, {
      method: 'POST',
      body: formData,
    });
  },
};
