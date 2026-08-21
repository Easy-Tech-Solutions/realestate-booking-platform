import React from 'react';
import { Navigate, useLocation } from 'react-router';
import { useApp } from '../../hooks/useApp';
import { AccessDenied } from './AccessDenied';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireHost?: boolean;
  requireAgent?: boolean;
  requireHostOrAgent?: boolean;
  requireAdmin?: boolean;
}

export function ProtectedRoute({ children, requireHost, requireAgent, requireHostOrAgent, requireAdmin }: ProtectedRouteProps) {
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

  if (requireAgent && !user?.isAgent) {
    return <Navigate to="/become-an-agent" replace />;
  }

  // Listing a property is allowed for hosts (own/MOU) and sourcing agents.
  if (requireHostOrAgent && !user?.isHost && !user?.isAgent) {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !user?.isAdmin && !user?.isStaff) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
