import React, { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { MobileNav } from '../components/MobileNav';
import { Toaster } from '../components/ui/sonner';

function RouteLoadingFallback() {
  return (
    <div className="mx-auto flex min-h-[40vh] w-full max-w-6xl items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-2xl space-y-4">
        <div className="h-10 w-48 animate-pulse rounded-xl bg-muted" />
        <div className="h-5 w-full animate-pulse rounded-lg bg-muted/80" />
        <div className="h-5 w-5/6 animate-pulse rounded-lg bg-muted/80" />
        <div className="grid gap-4 pt-4 sm:grid-cols-2">
          <div className="h-32 animate-pulse rounded-2xl bg-muted/70" />
          <div className="h-32 animate-pulse rounded-2xl bg-muted/70" />
        </div>
      </div>
    </div>
  );
}

export function RootLayout() {
  const location = useLocation();
  const fullscreen = ['/messages', '/host'].some(p => location.pathname === p || location.pathname.startsWith('/host'));
  const showHeader = !fullscreen;
  const showFooter = !fullscreen && !['/book', '/booking/confirmed'].includes(location.pathname);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showHeader && <Header />}
      <main className="flex-1 pb-16 md:pb-0">
        <Suspense fallback={<RouteLoadingFallback />}>
          <Outlet />
        </Suspense>
      </main>
      {showFooter && <Footer />}
      <MobileNav />
      <Toaster />
    </div>
  );
}