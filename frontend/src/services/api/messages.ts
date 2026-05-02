import type { Conversation, Message } from '../../core/types';
import { fetchWithAuth } from './shared/client';
import { normalizeConversation, normalizeMessage } from './shared/normalizers';

export const messagesAPI = {
  getConversations: async (): Promise<Conversation[]> => {
    const data = await fetchWithAuth<unknown[]>('/api/messaging/conversations/');
    return data.map(normalizeConversation);
  },

  getMessages: async (conversationId: string): Promise<Message[]> => {
    const data = await fetchWithAuth<unknown[]>(`/api/messaging/conversations/${conversationId}/messages/`);
    return data.map(normalizeMessage);
  },

  sendMessage: async (conversationId: string, content: string): Promise<Message> => {
    const data = await fetchWithAuth(`/api/messaging/conversations/${conversationId}/messages/send/`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    return normalizeMessage(data);
  },

  startConversation: async (recipientId: string, initialMessage: string, listingId?: string): Promise<Conversation> => {
    const data = await fetchWithAuth('/api/messaging/conversations/start/', {
      method: 'POST',
      body: JSON.stringify({ recipient_id: recipientId, initial_message: initialMessage, listing_id: listingId }),
    });
    return normalizeConversation(data);
  },

  getUnreadCount: async (): Promise<{ unread_count: number }> => {
    return fetchWithAuth('/api/messaging/unread-count/');
  },
};