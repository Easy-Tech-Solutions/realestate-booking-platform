import { fetchWithAuth } from './shared/client';

export interface ListingFlag {
  id: number;
  listing: number | null;
  listing_title: string | null;
  listing_status: string | null;
  flag_type: 'duplicate' | 'price_anomaly' | 'manual';
  flag_type_display: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'dismissed' | 'confirmed';
  details: string;
  ai_score: number | null;
  ai_rationale: string;
  reviewed_by: number | null;
  reviewed_by_username: string | null;
  reviewed_at: string | null;
  review_notes: string;
  created_at: string;
}

export interface InventoryListing {
  id: number;
  title: string;
  status: 'draft' | 'pending_review' | 'published' | 'rejected' | 'suspended';
  price: string;
  property_type: string;
  city: string;
  state: string;
  country: string;
  owner: number;
  owner_username: string;
  owner_email: string;
  deleted_at: string | null;
  suspended_by: number | null;
  suspended_by_username: string | null;
  suspended_at: string | null;
  suspension_reason: string;
  max_guests: number;
  local_registration_number: string;
  occupancy_cap: number | null;
  open_flag_count: number;
  created_at: string;
  updated_at: string;
}

export interface InventoryListingPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: InventoryListing[];
}

export const inventoryAPI = {
  searchListings: async (params: { status?: string; search?: string; flaggedOnly?: boolean; page?: number } = {}): Promise<InventoryListingPage> => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.search) qs.set('search', params.search);
    if (params.flaggedOnly) qs.set('flagged', 'true');
    if (params.page) qs.set('page', String(params.page));
    return fetchWithAuth<InventoryListingPage>(`/api/inventory/listings/?${qs.toString()}`);
  },

  suspendListing: async (id: number, reason: string): Promise<InventoryListing> => {
    return fetchWithAuth<InventoryListing>(`/api/inventory/listings/${id}/suspend/`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  unsuspendListing: async (id: number): Promise<InventoryListing> => {
    return fetchWithAuth<InventoryListing>(`/api/inventory/listings/${id}/unsuspend/`, {
      method: 'POST',
    });
  },

  listFlags: async (statusFilter = 'open'): Promise<ListingFlag[]> => {
    return fetchWithAuth<ListingFlag[]>(`/api/inventory/flags/?status=${encodeURIComponent(statusFilter)}`);
  },

  scanForFlags: async (): Promise<{ created: number; by_detector: Record<string, number> }> => {
    return fetchWithAuth('/api/inventory/flags/scan/', { method: 'POST' });
  },

  createManualFlag: async (listingId: number, details: string, severity: 'low' | 'medium' | 'high' = 'medium'): Promise<ListingFlag> => {
    return fetchWithAuth<ListingFlag>('/api/inventory/flags/manual/', {
      method: 'POST',
      body: JSON.stringify({ listing: listingId, details, severity }),
    });
  },

  reviewFlag: async (id: number, decision: 'dismissed' | 'confirmed', notes = ''): Promise<ListingFlag> => {
    return fetchWithAuth<ListingFlag>(`/api/inventory/flags/${id}/review/`, {
      method: 'POST',
      body: JSON.stringify({ status: decision, notes }),
    });
  },

  updateCompliance: async (listingId: number, payload: Partial<{ local_registration_number: string; occupancy_cap: number | null }>): Promise<InventoryListing> => {
    return fetchWithAuth<InventoryListing>(`/api/inventory/listings/${listingId}/compliance/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  bulkAction: async (payload: { action: 'suspend' | 'unsuspend'; listing_ids: number[]; reason?: string }): Promise<{ succeeded: number[]; failed: { listing_id: number; error: string }[] }> => {
    return fetchWithAuth('/api/inventory/listings/bulk/', { method: 'POST', body: JSON.stringify(payload) });
  },
};
