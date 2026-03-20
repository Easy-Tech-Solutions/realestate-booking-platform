import React from 'react';
import { Outlet, useLocation } from 'react-router';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Toaster } from '../components/ui/sonner';

export function RootLayout() {
  const location = useLocation();
  const showHeader = location.pathname !== '/messages';
  const showFooter = location.pathname !== '/messages' && location.pathname !== '/book';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showHeader && <Header />}
      <main className="flex-1">
        <Outlet />
      </main>
      {showFooter && <Footer />}
      <Toaster />
    </div>
  );
}