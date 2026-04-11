import { fetchWithAuth } from './shared/client';

export const usersAPI = {
  getById: async (id: string): Promise<any> => {
    return fetchWithAuth(`/api/users/${id}/`);
  },

  updateMyProfile: async (payload: Record<string, any>): Promise<any> => {
    return fetchWithAuth('/api/users/me/profile/', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  initiatePhoneChange: async (payload: {
    password: string;
    new_phone_number: string;
    network_provider: 'mtn' | 'orange';
  }): Promise<{ message: string }> => {
    return fetchWithAuth('/api/users/phone-change/initiate/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  verifyPhoneChangeEmail: async (otp: string): Promise<{ message: string }> => {
    return fetchWithAuth('/api/users/phone-change/verify-email/', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    });
  },

  verifyPhoneChangeSms: async (otp: string): Promise<{ message: string }> => {
    return fetchWithAuth('/api/users/phone-change/verify-sms/', {
      method: 'POST',
      body: JSON.stringify({ otp }),
    });
  },

  cancelPhoneChange: async (): Promise<{ message: string }> => {
    return fetchWithAuth('/api/users/phone-change/cancel/', {
      method: 'DELETE',
    });
  },
};