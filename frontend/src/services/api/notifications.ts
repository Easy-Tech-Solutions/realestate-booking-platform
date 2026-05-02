import { fetchWithAuth } from './shared/client';
import type { NotificationPreferencesResponse } from './shared/contracts';

export const notificationsAPI = {
  getAll: async () => {
    return fetchWithAuth('/api/notifications/');
  },

  markRead: async (id: string) => {
    return fetchWithAuth(`/api/notifications/${id}/read/`, { method: 'POST' });
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
};