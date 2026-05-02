import type { User } from '../../core/types';
import { fetchWithAuth, fetchPublicJson, clearTokens, setTokens } from './shared/client';
import type { AuthLoginResponse } from './shared/contracts';
import { normalizeUser } from './shared/normalizers';

export type GoogleSignupRole = 'user' | 'agent';

export type GoogleLoginResult =
  | { status: 'success'; user: User; access: string; refresh: string }
  | {
      status: 'needs_role';
      idToken: string;
      email: string;
      suggestedUsername: string;
      firstName: string;
      lastName: string;
    };

interface GoogleLoginNeedsRoleResponse {
  needs_role: true;
  email: string;
  suggested_username: string;
  first_name: string;
  last_name: string;
}

type GoogleLoginRawResponse = AuthLoginResponse | GoogleLoginNeedsRoleResponse;

function isNeedsRole(data: GoogleLoginRawResponse): data is GoogleLoginNeedsRoleResponse {
  return (data as GoogleLoginNeedsRoleResponse).needs_role === true;
}

export const authAPI = {
  login: async (username: string, password: string): Promise<{ user: User; access: string; refresh: string }> => {
    clearTokens();
    const data = await fetchPublicJson<AuthLoginResponse>('/api/auth/login/', {
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

  loginWithGoogle: async (idToken: string, role?: GoogleSignupRole): Promise<GoogleLoginResult> => {
    clearTokens();
    const body: { id_token: string; role?: GoogleSignupRole } = { id_token: idToken };
    if (role) body.role = role;

    const data = await fetchPublicJson<GoogleLoginRawResponse>('/api/auth/google/', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (isNeedsRole(data)) {
      return {
        status: 'needs_role',
        idToken,
        email: data.email,
        suggestedUsername: data.suggested_username,
        firstName: data.first_name,
        lastName: data.last_name,
      };
    }

    setTokens(data.access, data.refresh);
    return {
      status: 'success',
      user: normalizeUser(data.user),
      access: data.access,
      refresh: data.refresh,
    };
  },
};
