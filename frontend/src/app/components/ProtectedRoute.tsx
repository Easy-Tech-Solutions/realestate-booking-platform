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
    return <Navigate to="/" state={{ from: location, openAuth: true }} replace />;
  }

  if (requireHost && !user?.isHost) {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !user?.isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
