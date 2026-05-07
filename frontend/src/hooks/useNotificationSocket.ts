import { useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { WS_BASE_URL } from '../core/constants';
import { getAccessToken } from '../services/api.service';
import { queryKeys } from './queries/keys';

export function useNotificationSocket(enabled: boolean) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!enabled || !token) return;

    const ws = new WebSocket(`${WS_BASE_URL}/ws/notifications/`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'authenticate', token }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'new_notification') {
          const n = data.notification;
          // Show a toast for incoming notifications
          toast(n.title, {
            description: n.message,
            duration: 5000,
          });
          // Invalidate notification queries so the bell badge updates
          queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = (e) => {
      // Reconnect unless intentionally closed (code 1000) or disabled
      if (enabled && e.code !== 1000) {
        reconnectTimer.current = setTimeout(connect, 5000);
      }
    };

    ws.onerror = () => ws.close();
  }, [enabled, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close(1000, 'unmount');
    };
  }, [connect]);
}
