import React from 'react';
import { useNavigate } from 'react-router';
import { Home, Search } from 'lucide-react';
import { Button } from '../components/ui/button';

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold text-primary mb-4">404</div>
        <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex gap-3 justify-center">
          <Button onClick={() => navigate('/')}>
            <Home className="w-4 h-4 mr-2" /> Go Home
          </Button>
          <Button variant="outline" onClick={() => navigate('/search')}>
            <Search className="w-4 h-4 mr-2" /> Search Stays
          </Button>
        </div>
      </div>
    </div>
  );
}
