import React from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Home, Search, Heart, MessageSquare, User } from 'lucide-react';
import { cn } from '../../core/utils';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';

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

  const hiddenOn = ['/messages', '/book'];
  if (hiddenOn.includes(location.pathname) || location.pathname.startsWith('/host')) return null;

  const handleNav = (to: string, isProtected: boolean) => {
    if (isProtected && !isAuthenticated) {
      toast.info('Sign in to access this feature', { id: 'auth-required' });
      return;
    }
    navigate(to);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ to, icon: Icon, label, protected: isProtected }) => {
          const active = location.pathname === to;
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
  );
}
