import React from 'react';
import { Outlet, useLocation } from 'react-router';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { MobileNav } from '../components/MobileNav';
import { Toaster } from '../components/ui/sonner';

export function RootLayout() {
  const location = useLocation();
  const fullscreen = ['/messages', '/host'].some(p => location.pathname === p || location.pathname.startsWith('/host'));
  const showHeader = !fullscreen;
  const showFooter = !fullscreen && !['/book', '/booking/confirmed'].includes(location.pathname);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showHeader && <Header />}
      <main className="flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>
      {showFooter && <Footer />}
      <MobileNav />
      <Toaster />
    </div>
  );
}