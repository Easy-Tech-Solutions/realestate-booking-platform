import { API_BASE_URL } from '../../../core/constants';
import { ApiError } from './errors';

// Access token lives only in JS memory — never in localStorage/sessionStorage.
// The refresh token is stored as an httpOnly cookie (set by the server).
let accessToken: string | null = null;

export const setTokens = (access: string, _refresh?: string) => {
  accessToken = access;
};

export const clearTokens = () => {
  accessToken = null;
};

export const getAccessToken = () => accessToken;

export async function fetchPublicJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(!(options.body instanceof FormData) && { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers, credentials: 'include' });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(error.error || response.statusText, response.status, error);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

export async function attemptTokenRefresh(): Promise<string | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // sends httpOnly refresh cookie
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const data = await response.json();
    accessToken = data.access;
    return data.access;
  } catch {
    clearTokens();
    return null;
  }
}

export async function fetchWithAuth<T>(url: string, options: RequestInit = {}): Promise<T> {
  const makeRequest = async (token: string | null) => {
    const headers: Record<string, string> = {
      ...(!(options.body instanceof FormData) && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...(options.headers as Record<string, string>),
    };

    return fetch(`${API_BASE_URL}${url}`, { ...options, headers, credentials: 'include' });
  };

  let response = await makeRequest(accessToken);

  if (response.status === 401) {
    const newToken = await attemptTokenRefresh();
    if (newToken) {
      response = await makeRequest(newToken);
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(error.error || response.statusText, response.status, error);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}
