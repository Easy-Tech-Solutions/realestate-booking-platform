import React from 'react';
import { Link, useLocation } from 'react-router';
import { Home, Search, Heart, MessageSquare, User } from 'lucide-react';
import { cn } from '../../core/utils';
import { useApp } from '../../core/context';

const navItems = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/wishlists', icon: Heart, label: 'Wishlists' },
  { to: '/messages', icon: MessageSquare, label: 'Messages' },
  { to: '/account', icon: User, label: 'Profile' },
];

export function MobileNav() {
  const location = useLocation();
  const { isAuthenticated } = useApp();

  const hiddenOn = ['/messages', '/book'];
  if (hiddenOn.includes(location.pathname) || location.pathname.startsWith('/host')) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border md:hidden">
      <div className="flex items-center justify-around h-16">
        {navItems.map(({ to, icon: Icon, label }) => {
          const active = location.pathname === to;
          return (
            <Link
              key={to}
              to={isAuthenticated || to === '/' || to === '/search' ? to : '/'}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors',
                active ? 'text-primary' : 'text-muted-foreground'
              )}
              aria-label={label}
            >
              <Icon className={cn('w-5 h-5', active && 'stroke-[2.5]')} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
