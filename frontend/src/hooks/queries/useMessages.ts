import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { messagesAPI } from '../../services/api.service';
import { queryKeys } from './keys';
import type { Message } from '../../core/types';

export function useConversations(enabled = true) {
  return useQuery({
    queryKey: queryKeys.messages.conversations,
    queryFn: () => messagesAPI.getConversations(),
    enabled,
  });
}

export function useConversationMessages(conversationId?: string) {
  return useQuery({
    queryKey: conversationId ? queryKeys.messages.thread(conversationId) : ['messages', 'thread', 'empty'],
    queryFn: () => messagesAPI.getMessages(conversationId!),
    enabled: Boolean(conversationId),
  });
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, content }: { conversationId: string; content: string }) =>
      messagesAPI.sendMessage(conversationId, content),
    onSuccess: (message: Message) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.messages.conversations });
      queryClient.setQueryData<Message[]>(queryKeys.messages.thread(message.conversationId), (current = []) => [...current, message]);
    },
  });
}