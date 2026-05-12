import React from 'react';
import { Navigate, useLocation } from 'react-router';
import { useApp } from '../../hooks/useApp';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireHost?: boolean;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireHost, requireAdmin }: ProtectedRouteProps) {
  const { isAuthenticated, user, isLoading } = useApp();
  const location = useLocation();

  if (isLoading) return null;

  if (!isAuthenticated) {
    const target = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(target)}`} replace />;
  }

  if (requireHost && !user?.isHost) {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !user?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
