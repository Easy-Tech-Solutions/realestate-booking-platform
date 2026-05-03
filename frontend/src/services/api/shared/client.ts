import { API_BASE_URL } from '../../../core/constants';
import { ApiError } from './errors';

let accessToken: string | null = localStorage.getItem('accessToken');
let refreshToken: string | null = localStorage.getItem('refreshToken');

export const setTokens = (access: string, refresh: string) => {
  accessToken = access;
  refreshToken = refresh;
  localStorage.setItem('accessToken', access);
  localStorage.setItem('refreshToken', refresh);
};

export const clearTokens = () => {
  accessToken = null;
  refreshToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
};

export const getAccessToken = () => accessToken;

export async function fetchPublicJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(!(options.body instanceof FormData) && { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new ApiError(error.error || response.statusText, response.status, error);
  }

  if (response.status === 204) {
    return null as T;
  }

  return response.json() as Promise<T>;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh-token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: refreshToken }),
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const data = await response.json();
    accessToken = data.access;
    localStorage.setItem('accessToken', data.access);
    if (data.refresh) {
      refreshToken = data.refresh;
      localStorage.setItem('refreshToken', data.refresh);
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

    return fetch(`${API_BASE_URL}${url}`, { ...options, headers });
  };

  let response = await makeRequest(accessToken);

  if (response.status === 401 && refreshToken) {
    const newToken = await refreshAccessToken();
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