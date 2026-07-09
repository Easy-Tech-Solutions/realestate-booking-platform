import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { propertyVerificationsAPI, type PropertyVerification } from '../../services/api/propertyVerifications';
import { getErrorMessage } from '../../services/api/shared/errors';

const STAGE_LABEL: Record<string, string> = {
  product_support: 'Product Support review',
  compliance: 'Compliance (site inspection)',
  supervisor: 'Supervisor review',
};

/**
 * Shows the verification status for one of the host's listings and, when a
 * correction has been requested, lets them resubmit. Renders nothing for
 * already-published (approved) listings or listings without a verification.
 */
export function ListingVerificationCell({ listingId }: { listingId: number | string }) {
  const [v, setV] = useState<PropertyVerification | null>(null);
  const [loading, setLoading] = useState(true);
  const [resubmitting, setResubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    propertyVerificationsAPI
      .getForListing(listingId)
      .then((res) => { if (active) setV(res); })
      .catch(() => { if (active) setV(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listingId]);

  if (loading || !v || v.status === 'approved') return null;

  const resubmit = async () => {
    setResubmitting(true);
    try {
      const updated = await propertyVerificationsAPI.resubmit(v.id, new FormData());
      setV(updated);
      toast.success('Resubmitted for verification — we’ll review it again.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not resubmit. Please try again.'));
    } finally {
      setResubmitting(false);
    }
  };

  if (v.status === 'correction_requested') {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-medium text-amber-800">Correction needed before publishing</p>
        {v.review_notes && <p className="text-amber-700 mt-0.5">{v.review_notes}</p>}
        <p className="text-amber-700 mt-1 text-xs">Update your listing above (photos/details), then resubmit.</p>
        <Button size="sm" className="mt-2" disabled={resubmitting} onClick={resubmit}>
          {resubmitting ? 'Resubmitting…' : 'Resubmit for verification'}
        </Button>
      </div>
    );
  }

  if (v.status === 'rejected') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
        <p className="font-medium text-red-800">Verification declined</p>
        {v.review_notes && <p className="text-red-700 mt-0.5">{v.review_notes}</p>}
      </div>
    );
  }

  // Active review (submitted / ps_approved / compliance_approved)
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
      Under verification — currently at{' '}
      <strong>{STAGE_LABEL[v.current_stage || ''] || 'review'}</strong>. We’ll email you at each step.
    </div>
  );
}
