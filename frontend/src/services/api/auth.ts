import type { User } from '../../core/types';
import { fetchWithAuth, clearTokens, setTokens } from './shared/client';
import type { AuthLoginResponse } from './shared/contracts';
import { normalizeUser } from './shared/normalizers';

export const authAPI = {
  login: async (username: string, password: string): Promise<{ user: User; access: string; refresh: string }> => {
    const data = await fetchWithAuth<AuthLoginResponse>('/api/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setTokens(data.access, data.refresh);
    return { user: normalizeUser(data.user), access: data.access, refresh: data.refresh };
  },

  register: async (data: {
    username: string;
    email: string;
    password: string;
    password2: string;
    first_name?: string;
    last_name?: string;
  }): Promise<{ message: string }> => {
    return fetchWithAuth('/api/auth/register/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  verifyEmail: async (token: string): Promise<{ message: string }> => {
    return fetchWithAuth('/api/auth/verify-email/', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  logout: async (): Promise<void> => {
    try {
      await fetchWithAuth('/api/auth/logout/', {
        method: 'POST',
        body: JSON.stringify({ refresh: localStorage.getItem('refreshToken') }),
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
    return fetchWithAuth('/api/auth/password-reset/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  passwordResetConfirm: async (token: string, password: string, password2: string): Promise<{ message: string }> => {
    return fetchWithAuth('/api/auth/password-reset-confirm/', {
      method: 'POST',
      body: JSON.stringify({ token, password, password2 }),
    });
  },
};