import { fetchWithAuth, fetchPublicJson } from './shared/client';

export interface LegalDocumentSection {
  title: string;
  intro?: string;
  content: string | string[];
  outro?: string;
}

export interface LegalDocument {
  id: number;
  document_key: 'terms_of_service' | 'privacy_policy';
  document_key_display: string;
  version: string;
  effective_date: string;
  summary_of_changes: string;
  body_sections: LegalDocumentSection[];
  published_by: number | null;
  published_by_username: string | null;
  created_at: string;
}

export const legalDocumentsAPI = {
  current: async (): Promise<LegalDocument[]> => {
    return fetchPublicJson<LegalDocument[]>('/api/legal/documents/current/');
  },

  adminList: async (documentKey?: string): Promise<LegalDocument[]> => {
    const qs = documentKey ? `?document_key=${encodeURIComponent(documentKey)}` : '';
    return fetchWithAuth<LegalDocument[]>(`/api/legal/documents/${qs}`);
  },

  adminPublish: async (payload: {
    document_key: string; version: string; effective_date: string; summary_of_changes?: string; body_sections: LegalDocumentSection[];
  }): Promise<LegalDocument> => {
    return fetchWithAuth<LegalDocument>('/api/legal/documents/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
