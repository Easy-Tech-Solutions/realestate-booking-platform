import { fetchWithAuth, fetchPublicJson } from './shared/client';
import type { NotificationPreferencesResponse } from './shared/contracts';

export const notificationsAPI = {
  getAll: async () => {
    return fetchWithAuth('/api/notifications/');
  },

  markRead: async (id: string) => {
    return fetchWithAuth(`/api/notifications/${id}/read/`, { method: 'POST' });
  },

  markUnread: async (id: string) => {
    return fetchWithAuth(`/api/notifications/${id}/unread/`, { method: 'PATCH' });
  },

  deleteOne: async (id: string) => {
    return fetchWithAuth(`/api/notifications/${id}/`, { method: 'DELETE' });
  },

  markAllRead: async () => {
    return fetchWithAuth('/api/notifications/read-all/', { method: 'POST' });
  },

  getUnreadCount: async (): Promise<{ unread_count: number }> => {
    return fetchWithAuth('/api/notifications/unread-count/');
  },

  getPreferences: async () => {
    return fetchWithAuth<NotificationPreferencesResponse>('/api/notifications/preferences/');
  },

  updatePreferences: async (partialPrefs: Record<string, any>) => {
    return fetchWithAuth('/api/notifications/preferences/', {
      method: 'PATCH',
      body: JSON.stringify(partialPrefs),
    });
  },

  getVapidPublicKey: async (): Promise<string | null> => {
    try {
      const data = await fetchPublicJson<{ public_key: string }>('/api/notifications/vapid-public-key/');
      return data.public_key ?? null;
    } catch {
      return null;
    }
  },

  registerDeviceToken: async (payload: {
    endpoint: string;
    p256dh: string;
    auth: string;
    device_type?: string;
  }) => {
    return fetchWithAuth('/api/notifications/device-token/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  unregisterDeviceToken: async (endpoint: string) => {
    return fetchWithAuth('/api/notifications/device-token/', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    });
  },
};