import type { User } from '../../core/types';
import { fetchWithAuth, fetchPublicJson, clearTokens, setTokens } from './shared/client';
import type { AuthLoginResponse } from './shared/contracts';
import { normalizeUser } from './shared/normalizers';
import { getDeviceFingerprint } from '../../core/deviceFingerprint';

export interface GoogleLoginResult {
  status: 'success';
  user: User;
  access: string;
}

export class MfaRequiredError extends Error {
  mfaToken: string;
  constructor(mfaToken: string) {
    super('MFA verification required');
    this.name = 'MfaRequiredError';
    this.mfaToken = mfaToken;
  }
}

export const authAPI = {
  login: async (email: string, password: string): Promise<{ user: User; access: string }> => {
    clearTokens();
    const fingerprint = await getDeviceFingerprint();
    const data = await fetchPublicJson<AuthLoginResponse>('/api/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: fingerprint ? { 'X-Device-Fingerprint': fingerprint } : {},
    });
    if (data.mfa_required) {
      throw new MfaRequiredError(data.mfa_token!);
    }
    setTokens(data.access);
    return { user: normalizeUser(data.user), access: data.access };
  },

  verifyMfaLogin: async (mfaToken: string, code: string): Promise<{ user: User; access: string }> => {
    const data = await fetchPublicJson<AuthLoginResponse>('/api/superadmin/mfa/verify-login/', {
      method: 'POST',
      body: JSON.stringify({ mfa_token: mfaToken, code }),
    });
    setTokens(data.access);
    return { user: normalizeUser(data.user), access: data.access };
  },

  // Step-up fallback for a lost authenticator device — emails a one-time
  // code that verifyMfaLogin accepts in place of a TOTP/backup code.
  sendMfaEmailCode: async (mfaToken: string): Promise<{ message: string }> => {
    return fetchPublicJson('/api/superadmin/mfa/send-email-code/', {
      method: 'POST',
      body: JSON.stringify({ mfa_token: mfaToken }),
    });
  },

  register: async (data: {
    email: string;
    password: string;
    password2: string;
    first_name?: string;
    last_name?: string;
    date_of_birth: string;
  }): Promise<{ message: string }> => {
    const fingerprint = await getDeviceFingerprint();
    return fetchPublicJson('/api/auth/register/', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: fingerprint ? { 'X-Device-Fingerprint': fingerprint } : {},
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
    const fingerprint = await getDeviceFingerprint();
    const data = await fetchPublicJson<AuthLoginResponse>('/api/auth/google/', {
      method: 'POST',
      body: JSON.stringify({ id_token: idToken }),
      headers: fingerprint ? { 'X-Device-Fingerprint': fingerprint } : {},
    });
    setTokens(data.access);
    return {
      status: 'success',
      user: normalizeUser(data.user),
      access: data.access,
    };
  },
};
