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

  sendMessage: async (conversationId: string, content: string, replyToId?: string): Promise<Message> => {
    const body: Record<string, string> = { content };
    if (replyToId) body.reply_to_id = replyToId;
    const data = await fetchWithAuth(`/api/messaging/conversations/${conversationId}/messages/send/`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return normalizeMessage(data);
  },

  sendMessageWithFiles: async (conversationId: string, content: string, files: File[], replyToId?: string): Promise<Message> => {
    const form = new FormData();
    if (content.trim()) form.append('content', content.trim());
    if (replyToId) form.append('reply_to_id', replyToId);
    files.forEach(f => form.append('files', f));
    const data = await fetchWithAuth(`/api/messaging/conversations/${conversationId}/messages/send/`, {
      method: 'POST',
      body: form,
    });
    return normalizeMessage(data);
  },

  editMessage: async (messageId: string, content: string): Promise<Message> => {
    const data = await fetchWithAuth(`/api/messaging/messages/${messageId}/edit/`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    });
    return normalizeMessage(data);
  },

  deleteConversation: async (conversationId: string): Promise<void> => {
    await fetchWithAuth(`/api/messaging/conversations/${conversationId}/`, {
      method: 'DELETE',
    });
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

  getPresence: async (userId: string): Promise<{ online: boolean; last_seen: string | null }> => {
    return fetchWithAuth(`/api/messaging/users/${userId}/presence/`);
  },
};
