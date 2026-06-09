import type { User } from '../../core/types';
import { fetchWithAuth, fetchPublicJson, clearTokens, setTokens } from './shared/client';
import type { AuthLoginResponse } from './shared/contracts';
import { normalizeUser } from './shared/normalizers';

export interface GoogleLoginResult {
  status: 'success';
  user: User;
  access: string;
}

export const authAPI = {
  login: async (email: string, password: string): Promise<{ user: User; access: string }> => {
    clearTokens();
    const data = await fetchPublicJson<AuthLoginResponse>('/api/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setTokens(data.access);
    return { user: normalizeUser(data.user), access: data.access };
  },

  register: async (data: {
    email: string;
    password: string;
    password2: string;
    first_name?: string;
    last_name?: string;
  }): Promise<{ message: string }> => {
    return fetchPublicJson('/api/auth/register/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    return fetchPublicJson('/api/auth/verify-email/', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  logout: async (): Promise<void> => {
    try {
      await fetchWithAuth('/api/auth/logout/', {
        method: 'POST',
      });
    } catch {
      // Ignore logout network failures and clear local state anyway.
    }
    clearTokens();
  },

  getCurrentUser: async (): Promise<User> => {
    const data = await fetchWithAuth('/api/auth/me/');
    return normalizeUser(data);
  },

  passwordResetRequest: async (email: string): Promise<{ message: string }> => {
    return fetchPublicJson('/api/auth/password-reset/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  passwordResetConfirm: async (token: string, password: string, password2: string): Promise<{ message: string }> => {
    return fetchPublicJson('/api/auth/password-reset-confirm/', {
      method: 'POST',
      body: JSON.stringify({ token, password, password2 }),
    });
  },

  loginWithGoogle: async (idToken: string): Promise<GoogleLoginResult> => {
    clearTokens();
    const data = await fetchPublicJson<AuthLoginResponse>('/api/auth/google/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
    });
    setTokens(data.access);
    return {
      status: 'success',
      user: normalizeUser(data.user),
      access: data.access,
    };
  },
};
