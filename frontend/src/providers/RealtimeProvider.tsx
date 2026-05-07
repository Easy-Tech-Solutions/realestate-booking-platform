import type { ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { useNotificationSocket } from '../hooks/useNotificationSocket';
import { usePushNotifications } from '../hooks/usePushNotifications';

function RealtimeCore() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  useNotificationSocket(isAuthenticated);
  usePushNotifications(isAuthenticated);
  return null;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  return (
    <>
      <RealtimeCore />
      {children}
    </>
  );
}
