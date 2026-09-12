import { fetchWithAuth } from './shared/client';

export interface StaffEducation {
  id: number;
  institution: string;
  degree: string;
  field_of_study: string;
  start_year: number | null;
  end_year: number | null;
  description: string;
  created_at: string;
}

export interface StaffLegalRecord {
  id: number;
  record_type: 'national_id' | 'work_permit' | 'contract' | 'certification' | 'other';
  title: string;
  issuing_authority: string;
  document_number: string;
  issue_date: string | null;
  expiry_date: string | null;
  document_url: string | null;
  notes: string;
  created_at: string;
}

export interface StaffProfile {
  id: number;
  user: number;
  full_name: string;
  email: string;
  username: string;
  position: string;
  department: string;
  hire_date: string | null;
  phone_number: string;
  bio: string;
  is_active: boolean;
  onboarded_by_username: string | null;
  education: StaffEducation[];
  legal_records: StaffLegalRecord[];
  created_at: string;
  updated_at: string;
}

export const staffAPI = {
  // Admin/HR
  adminList: (): Promise<StaffProfile[]> => fetchWithAuth('/api/superadmin/staff/'),

  adminOnboard: (data: {
    email: string; first_name?: string; last_name?: string;
    position?: string; department?: string; hire_date?: string; phone_number?: string;
  }): Promise<StaffProfile & { account_created: boolean }> =>
    fetchWithAuth('/api/superadmin/staff/', { method: 'POST', body: JSON.stringify(data) }),

  adminUpdate: (id: number, data: Partial<{
    position: string; department: string; hire_date: string; phone_number: string; is_active: boolean;
  }>): Promise<StaffProfile> =>
    fetchWithAuth(`/api/superadmin/staff/${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),

  adminOffboard: (id: number): Promise<null> =>
    fetchWithAuth(`/api/superadmin/staff/${id}/`, { method: 'DELETE' }),

  // Self-service
  me: (): Promise<StaffProfile> => fetchWithAuth('/api/superadmin/staff/me/'),

  updateMe: (data: Partial<{ bio: string; phone_number: string }>): Promise<StaffProfile> =>
    fetchWithAuth('/api/superadmin/staff/me/', { method: 'PATCH', body: JSON.stringify(data) }),

  addEducation: (data: Partial<StaffEducation>): Promise<StaffEducation> =>
    fetchWithAuth('/api/superadmin/staff/me/education/', { method: 'POST', body: JSON.stringify(data) }),

  updateEducation: (id: number, data: Partial<StaffEducation>): Promise<StaffEducation> =>
    fetchWithAuth(`/api/superadmin/staff/me/education/${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteEducation: (id: number): Promise<null> =>
    fetchWithAuth(`/api/superadmin/staff/me/education/${id}/`, { method: 'DELETE' }),

  addLegalRecord: (data: FormData): Promise<StaffLegalRecord> =>
    fetchWithAuth('/api/superadmin/staff/me/legal/', { method: 'POST', body: data }),

  updateLegalRecord: (id: number, data: Partial<StaffLegalRecord>): Promise<StaffLegalRecord> =>
    fetchWithAuth(`/api/superadmin/staff/me/legal/${id}/`, { method: 'PATCH', body: JSON.stringify(data) }),

  deleteLegalRecord: (id: number): Promise<null> =>
    fetchWithAuth(`/api/superadmin/staff/me/legal/${id}/`, { method: 'DELETE' }),
};
