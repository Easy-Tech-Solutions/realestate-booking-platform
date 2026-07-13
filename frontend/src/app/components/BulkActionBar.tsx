import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui/button';

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  children: ReactNode;
}

/**
 * Generic "N selected" toolbar for any list page with row checkboxes.
 * Renders nothing when nothing is selected. Pass the action buttons as
 * children — this component only owns the layout/clear affordance.
 */
export function BulkActionBar({ selectedCount, onClear, children }: BulkActionBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
      <span className="text-sm font-medium whitespace-nowrap">{selectedCount} selected</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        <X className="h-3.5 w-3.5 mr-1" /> Clear
      </Button>
    </div>
  );
}
