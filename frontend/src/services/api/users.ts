import { fetchWithAuth } from './shared/client';

export const usersAPI = {
  getById: async (id: string): Promise<any> => {
    return fetchWithAuth(`/api/users/${id}/`);
  },

  updateMyProfile: async (payload: {
    first_name?: string;
    last_name?: string;
    email?: string;
    bio?: string;
    image?: File;
  }): Promise<any> => {
    if (payload.image) {
      const form = new FormData();
      if (payload.first_name !== undefined) form.append('first_name', payload.first_name);
      if (payload.last_name !== undefined) form.append('last_name', payload.last_name);
      if (payload.email !== undefined) form.append('email', payload.email);
      if (payload.bio !== undefined) form.append('bio', payload.bio);
      form.append('image', payload.image);
      return fetchWithAuth('/api/users/me/profile/', { method: 'PATCH', body: form });
    }
    return fetchWithAuth('/api/users/me/profile/', {
      method: 'PATCH',
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