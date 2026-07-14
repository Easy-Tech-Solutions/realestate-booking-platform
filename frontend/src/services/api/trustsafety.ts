import { fetchWithAuth } from './shared/client';

export interface FraudFlag {
  id: number;
  user: number | null;
  user_username: string | null;
  user_email: string | null;
  flag_type: 'rapid_signup' | 'shared_card' | 'transaction_spike' | 'manual';
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

export interface BlockedFingerprint {
  id: number;
  fingerprint: string;
  reason: string;
  blocked_by: number | null;
  blocked_by_username: string | null;
  created_at: string;
}

export interface BlacklistedLocation {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
  radius_km: string;
  reason: string;
  created_by: number | null;
  created_by_username: string | null;
  created_at: string;
}

export const trustSafetyAPI = {
  listFraudFlags: async (statusFilter = 'open'): Promise<FraudFlag[]> => {
    return fetchWithAuth<FraudFlag[]>(`/api/trust-safety/fraud-flags/?status=${encodeURIComponent(statusFilter)}`);
  },

  scanForFraud: async (): Promise<{ created: number; by_detector: Record<string, number> }> => {
    return fetchWithAuth('/api/trust-safety/fraud-flags/scan/', { method: 'POST' });
  },

  createManualFlag: async (userId: number, details: string, severity: 'low' | 'medium' | 'high' = 'medium'): Promise<FraudFlag> => {
    return fetchWithAuth<FraudFlag>('/api/trust-safety/fraud-flags/manual/', {
      method: 'POST',
      body: JSON.stringify({ user: userId, details, severity }),
    });
  },

  reviewFraudFlag: async (id: number, decision: 'dismissed' | 'confirmed', notes = ''): Promise<FraudFlag> => {
    return fetchWithAuth<FraudFlag>(`/api/trust-safety/fraud-flags/${id}/review/`, {
      method: 'POST',
      body: JSON.stringify({ status: decision, notes }),
    });
  },

  listBlockedFingerprints: async (): Promise<BlockedFingerprint[]> => {
    return fetchWithAuth<BlockedFingerprint[]>('/api/trust-safety/blocked-fingerprints/');
  },

  blockFingerprint: async (fingerprint: string, reason = ''): Promise<BlockedFingerprint> => {
    return fetchWithAuth<BlockedFingerprint>('/api/trust-safety/blocked-fingerprints/', {
      method: 'POST',
      body: JSON.stringify({ fingerprint, reason }),
    });
  },

  unblockFingerprint: async (id: number): Promise<void> => {
    await fetchWithAuth<void>(`/api/trust-safety/blocked-fingerprints/${id}/`, { method: 'DELETE' });
  },

  listBlacklistedLocations: async (): Promise<BlacklistedLocation[]> => {
    return fetchWithAuth<BlacklistedLocation[]>('/api/trust-safety/blacklisted-locations/');
  },

  blacklistLocation: async (
    name: string, latitude: number, longitude: number, radiusKm = 0.2, reason = '',
  ): Promise<BlacklistedLocation> => {
    return fetchWithAuth<BlacklistedLocation>('/api/trust-safety/blacklisted-locations/', {
      method: 'POST',
      body: JSON.stringify({ name, latitude, longitude, radius_km: radiusKm, reason }),
    });
  },

  removeBlacklistedLocation: async (id: number): Promise<void> => {
    await fetchWithAuth<void>(`/api/trust-safety/blacklisted-locations/${id}/`, { method: 'DELETE' });
  },
};
