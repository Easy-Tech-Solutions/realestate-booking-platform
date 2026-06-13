import { API_BASE_URL } from '../../../core/constants';
import { ApiError } from './errors';

// Neither token is kept in JavaScript-readable storage:
//   - the access token lives only in memory (this module), and
//   - the refresh token is an httpOnly, first-party cookie set by the backend,
//     so it survives page reloads but cannot be read by JS (mitigates XSS token
//     theft — TEST-AUTH-02).
// NOTE: this relies on the SPA and API being served same-site so the cookie is
// sent on refresh requests; see the backend deployment note.
let accessToken: string | null = null;

export const setTokens = (access: string) => {
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
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // sends the httpOnly refresh cookie
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const data = await response.json();
    // The backend rotates the refresh token and sets the new one as an httpOnly
    // cookie in this response; the browser stores it automatically.
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
