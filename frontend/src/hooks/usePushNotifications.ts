import { useEffect } from 'react';
import { registerPushSubscription } from '../core/push';

export function usePushNotifications(isAuthenticated: boolean) {
  useEffect(() => {
    if (!isAuthenticated) return;
    // Request permission and register subscription after login
    registerPushSubscription();
  }, [isAuthenticated]);
}
