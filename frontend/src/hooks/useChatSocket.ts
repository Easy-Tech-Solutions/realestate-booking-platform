import { useEffect, useRef, useCallback } from 'react';
import { WS_BASE_URL } from '../core/constants';
import { getAccessToken } from '../services/api.service';

export type ChatMessage = {
  type: 'chat_message';
  message_id: number;
  content: string;
  sender_id: number;
  sender_email: string;
  conversation_id: number;
  created_at: string;
  message_type: string;
  has_attachments?: boolean;
};

export type EditedMessage = {
  type: 'message_edited';
  message_id: number;
  content: string;
  edited_at: string;
  conversation_id: number;
};

export type ReadReceipt = {
  type: 'read_receipt';
  conversation_id: number;
  reader_id: number;
};

export type TypingEvent = {
  type: 'typing';
  user_id: number;
  user_name: string;
  conversation_id: number;
};

type ChatSocketOptions = {
  conversationId: number | null;
  onMessage: (msg: ChatMessage) => void;
  onMessageEdited?: (edit: EditedMessage) => void;
  onReadReceipt?: (receipt: ReadReceipt) => void;
  onTyping?: (event: TypingEvent) => void;
  onConnected?: () => void;
};

export function useChatSocket({
  conversationId,
  onMessage,
  onMessageEdited,
  onReadReceipt,
  onTyping,
  onConnected,
}: ChatSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const authenticatedRef = useRef(false);

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'chat_message', content }));
    }
  }, []);

  const markRead = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'mark_read' }));
    }
  }, []);

  const sendTyping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && authenticatedRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'typing' }));
    }
  }, []);

  useEffect(() => {
    if (!conversationId) return;

    const token = getAccessToken();
    if (!token) return;

    const connect = () => {
      authenticatedRef.current = false;
      const ws = new WebSocket(`${WS_BASE_URL}/ws/chat/${conversationId}/`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'authenticate', token }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'authenticated') {
            authenticatedRef.current = true;
            onConnected?.();
          } else if (data.type === 'chat_message') {
            onMessage(data as ChatMessage);
          } else if (data.type === 'message_edited') {
            onMessageEdited?.(data as EditedMessage);
          } else if (data.type === 'read_receipt') {
            onReadReceipt?.(data as ReadReceipt);
          } else if (data.type === 'typing') {
            onTyping?.(data as TypingEvent);
          }
        } catch {
          // ignore
        }
      };

      ws.onclose = (e) => {
        authenticatedRef.current = false;
        if (e.code !== 1000) {
          reconnectTimer.current = setTimeout(connect, 4000);
        }
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close(1000, 'unmount');
    };
  }, [conversationId, onMessage, onMessageEdited, onReadReceipt, onTyping, onConnected]);

  return { sendMessage, markRead, sendTyping };
}
