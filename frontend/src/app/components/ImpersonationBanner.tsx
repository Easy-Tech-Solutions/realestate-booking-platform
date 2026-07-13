import { UserCog, X } from 'lucide-react';
import { useApp } from '../../hooks/useApp';
import { toast } from 'sonner';

export function ImpersonationBanner() {
  const { impersonation, stopImpersonation, user } = useApp();
  if (!impersonation) return null;

  const handleExit = async () => {
    try {
      await stopImpersonation();
      toast.success('Exited impersonation.');
    } catch {
      toast.error('Failed to exit impersonation cleanly — reloading.');
      window.location.href = '/';
    }
  };

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <UserCog className="h-4 w-4 flex-shrink-0" />
      <span>
        Viewing as <strong>{user?.firstName} {user?.lastName}</strong> ({user?.email}) — impersonation session active
      </span>
      <button
        type="button"
        onClick={handleExit}
        className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-950/10 px-3 py-1 font-semibold hover:bg-amber-950/20 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        Exit
      </button>
    </div>
  );
}
