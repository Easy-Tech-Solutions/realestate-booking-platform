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
  inspection_report_url: string | null;
  due_diligence_done: boolean;
  inspection_latitude: string | null;
  inspection_longitude: string | null;
  created_at: string;
  updated_at: string;
  // Only present in reviewer-facing responses (review queue / review decision) —
  // never returned to the host being assessed.
  ai_risk_score?: number | null;
  ai_rationale?: string;
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

  /** Verifications awaiting review at any stage the caller is a reviewer for. */
  reviewQueue: async (): Promise<PropertyVerification[]> => {
    return fetchWithAuth<PropertyVerification[]>('/api/property-verifications/review-queue/');
  },

  /** approve | reject | request_correction at whichever stage this verification is awaiting.
   * At the Compliance stage, `inspectionData` carries the site-visit record
   * (due diligence flag, inspection report file, GPS coordinates) and forces
   * a multipart request; omit it for any other stage. */
  review: async (
    id: number,
    decision: 'approve' | 'reject' | 'request_correction',
    notes = '',
    inspectionData?: {
      due_diligence_done?: boolean;
      inspection_report?: File | null;
      inspection_latitude?: string;
      inspection_longitude?: string;
    },
  ): Promise<PropertyVerification> => {
    if (inspectionData) {
      const formData = new FormData();
      formData.append('decision', decision);
      formData.append('notes', notes);
      if (inspectionData.due_diligence_done !== undefined) {
        formData.append('due_diligence_done', String(inspectionData.due_diligence_done));
      }
      if (inspectionData.inspection_report) {
        formData.append('inspection_report', inspectionData.inspection_report);
      }
      if (inspectionData.inspection_latitude) {
        formData.append('inspection_latitude', inspectionData.inspection_latitude);
      }
      if (inspectionData.inspection_longitude) {
        formData.append('inspection_longitude', inspectionData.inspection_longitude);
      }
      return fetchWithAuth<PropertyVerification>(`/api/property-verifications/${id}/review/`, {
        method: 'POST',
        body: formData,
      });
    }
    return fetchWithAuth<PropertyVerification>(`/api/property-verifications/${id}/review/`, {
      method: 'POST',
      body: JSON.stringify({ decision, notes }),
    });
  },
};
