import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Home, Search, Heart, MessageSquare, User, LogIn } from 'lucide-react';
import { cn } from '../../core/utils';
import { useApp } from '../../hooks/useApp';
import { AuthDialog } from './AuthDialog';
import { Button } from './ui/button';

const navItems = [
  { to: '/', icon: Home, label: 'Home', protected: false },
  { to: '/search', icon: Search, label: 'Search', protected: false },
  { to: '/wishlists', icon: Heart, label: 'Wishlists', protected: true },
  { to: '/messages', icon: MessageSquare, label: 'Messages', protected: true },
  { to: '/account', icon: User, label: 'Profile', protected: true },
];

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useApp();
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);
  const [showAuthDialog, setShowAuthDialog] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const hiddenOn = ['/book'];
  if (hiddenOn.includes(location.pathname) || location.pathname.startsWith('/host')) return null;

  const handleNav = (to: string, isProtected: boolean) => {
    if (isProtected && !isAuthenticated) {
      setShowAuthPrompt(true);
      return;
    }
    navigate(to);
  };

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-around h-16">
          {navItems.map(({ to, icon: Icon, label, protected: isProtected }) => {
            const active = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <button
                key={to}
                type="button"
                onClick={() => handleNav(to, isProtected)}
                className={cn(
                  'flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
                aria-label={label}
              >
                <Icon className={cn('w-5 h-5', active && 'stroke-[2.5]')} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Sign-in prompt dialog */}
      {showAuthPrompt && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAuthPrompt(false)} />
          <div className="relative bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-6 shadow-xl">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <LogIn className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Sign in required</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Please sign in or create an account to access this feature.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full">
                <Button
                  className="w-full"
                  onClick={() => {
                    setShowAuthPrompt(false);
                    setAuthMode('login');
                    setShowAuthDialog(true);
                  }}
                >
                  Log in
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setShowAuthPrompt(false);
                    setAuthMode('register');
                    setShowAuthDialog(true);
                  }}
                >
                  Create account
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-foreground mt-1"
                  onClick={() => setShowAuthPrompt(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AuthDialog
        open={showAuthDialog}
        onClose={() => setShowAuthDialog(false)}
        mode={authMode}
        onModeChange={setAuthMode}
      />
    </>
  );
}
