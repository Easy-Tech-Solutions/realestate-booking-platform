import React, { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { leaseAgreementsAPI, type LeaseAgreement } from '../../services/api/leaseAgreements';

/**
 * Shows an "Agreement of Lease" download link for a booking, if one exists
 * (long-term rentals only). Renders nothing otherwise. Used on both the
 * tenant's Trips and the owner's booking dashboards.
 */
export function LeaseDownloadLink({ bookingId, className }: { bookingId: number | string; className?: string }) {
  const [lease, setLease] = useState<LeaseAgreement | null>(null);

  useEffect(() => {
    let active = true;
    leaseAgreementsAPI
      .getForBooking(bookingId)
      .then((l) => { if (active) setLease(l); })
      .catch(() => { /* no lease */ });
    return () => { active = false; };
  }, [bookingId]);

  if (!lease || !lease.document_url) return null;

  return (
    <a
      href={lease.document_url}
      target="_blank"
      rel="noopener noreferrer"
      className={className || 'inline-flex items-center gap-1.5 text-sm text-primary font-medium hover:underline'}
    >
      <FileText className="w-4 h-4" />
      Agreement of Lease{lease.is_accepted ? ' (accepted)' : ''}
    </a>
  );
}
