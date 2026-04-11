import React, { useEffect, type ReactNode } from 'react';
import { useAppStore } from '../store/appStore';
import { AppQueryProvider } from './QueryProvider';

export function AppProvider({ children }: { children: ReactNode }) {
  const initialize = useAppStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return <AppQueryProvider>{children}</AppQueryProvider>;
}
