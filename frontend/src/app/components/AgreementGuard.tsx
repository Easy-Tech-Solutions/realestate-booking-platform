import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Loader2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { hostApplicationsAPI, type AgreementStatus } from '../../services/api/hostApplications';
import { getErrorMessage } from '../../services/api/shared/errors';

/**
 * Blocks its children until the user has accepted the current Property Owner
 * Agreement version. Hosts who accepted during their application pass straight
 * through; if a NEW version is published they're asked to re-accept once before
 * listing. Fails open (renders children) if the status can't be loaded, so a
 * transient API error never traps a host out of listing.
 */
export function AgreementGuard({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AgreementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    hostApplicationsAPI
      .agreementStatus()
      .then((s) => { if (active) setStatus(s); })
      .catch(() => { if (active) setStatus(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const accept = async () => {
    setSubmitting(true);
    try {
      const s = await hostApplicationsAPI.acceptAgreement();
      setStatus(s);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not record your acceptance. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Accepted current version (or status unavailable → fail open) → show the page.
  if (!status || status.accepted) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-16 max-w-xl">
        <div className="bg-card border border-border rounded-xl p-8 text-center shadow-sm">
          <div className="flex justify-center mb-5">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-semibold mb-2">Property Owner Agreement</h1>
          <p className="text-muted-foreground mb-6">
            {status.accepted_version
              ? 'An updated Property Owner Agreement has been published. Please review and accept the new version to continue listing.'
              : 'Please review and accept the Property Owner Agreement to list your property.'}
          </p>
          <label className="flex items-start gap-3 cursor-pointer text-left mb-6">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary shrink-0"
            />
            <span className="text-sm text-foreground">
              I have read and agree to the{' '}
              <Link
                to="/property-owner-agreement"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline"
              >
                Property Owner Agreement
              </Link>{' '}
              (version {status.version}).
            </span>
          </label>
          <Button size="lg" className="w-full" disabled={!agreed || submitting} onClick={accept}>
            {submitting ? 'Saving...' : 'Agree and continue'}
          </Button>
        </div>
      </div>
    </div>
  );
}
