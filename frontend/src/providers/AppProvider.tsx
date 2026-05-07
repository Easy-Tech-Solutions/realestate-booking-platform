import React, { useEffect, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { AppQueryProvider } from './QueryProvider';
import { RealtimeProvider } from './RealtimeProvider';

export function AppProvider({ children }: { children: ReactNode }) {
  const initialize = useAppStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <AppQueryProvider>
      <RealtimeProvider>
        {children}
      </RealtimeProvider>
    </AppQueryProvider>
  );
}
