import { API_BASE_URL } from '../../../core/constants';
import { ApiError } from './errors';

// Access token lives only in JS memory.
// Refresh token is stored in localStorage so it survives page refreshes on
// every browser — including mobile Safari, which blocks the cross-site
// httpOnly cookie we used to depend on.
const REFRESH_TOKEN_KEY = 'auth.refresh';
let accessToken: string | null = null;

export const setTokens = (access: string, refresh?: string) => {
  accessToken = access;
  if (refresh) {
    try { localStorage.setItem(REFRESH_TOKEN_KEY, refresh); } catch { /* storage disabled */ }
  }
};

export const clearTokens = () => {
  accessToken = null;
  try { localStorage.removeItem(REFRESH_TOKEN_KEY); } catch { /* storage disabled */ }
};

export const getAccessToken = () => accessToken;

const getRefreshToken = (): string | null => {
  try { return localStorage.getItem(REFRESH_TOKEN_KEY); } catch { return null; }
};

export async function fetchPublicJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(!(options.body instanceof FormData) && { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers, credentials: 'include' });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    // Different endpoints in our codebase use different keys for error
    // messages: home-grown views use `error`, DRF's built-in validation and
    // permission denials use `detail`. Fall through both so the caller
    // always gets a readable message. `response.statusText` is the last
    // resort because HTTP/2 (which Render uses) drops the reason phrase,
    // leaving it as an empty string — which would otherwise show a toast
    // with no text at all.
    const message =
      body.error ||
      body.detail ||
      body.message ||
      response.statusText ||
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status, body);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

export async function attemptTokenRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // sends legacy refresh cookie if still present
      body: JSON.stringify({ refresh }),
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const data = await response.json();
    accessToken = data.access;
    // Backend may rotate the refresh token; persist the new one if so.
    if (data.refresh) {
      try { localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh); } catch { /* storage disabled */ }
    }
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
    const body = await response.json().catch(() => ({}));
    // Different endpoints in our codebase use different keys for error
    // messages: home-grown views use `error`, DRF's built-in validation and
    // permission denials use `detail`. Fall through both so the caller
    // always gets a readable message. `response.statusText` is the last
    // resort because HTTP/2 (which Render uses) drops the reason phrase,
    // leaving it as an empty string — which would otherwise show a toast
    // with no text at all.
    const message =
      body.error ||
      body.detail ||
      body.message ||
      response.statusText ||
      `Request failed (${response.status})`;
    throw new ApiError(message, response.status, body);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}
