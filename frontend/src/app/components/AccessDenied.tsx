import { Link } from 'react-router';
import { ShieldAlert } from 'lucide-react';

export function AccessDenied() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center space-y-4 max-w-sm">
        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <ShieldAlert className="h-8 w-8 text-destructive" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold">Access denied</h1>
        <p className="text-muted-foreground text-sm">
          You don't have permission to view this page. If you believe this is a mistake, contact an administrator.
        </p>
        <Link
          to="/"
          className="inline-block px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
