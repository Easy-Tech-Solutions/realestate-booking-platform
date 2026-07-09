import React, { useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Upload, ArrowLeft } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { propertyVerificationsAPI, type PropertyVerification } from '../../services/api/propertyVerifications';
import { getErrorMessage } from '../../services/api/shared/errors';

type Ownership = 'owner' | 'non_owner';

interface Props {
  listingId: number;
  defaultLocation?: string;
  onSubmitted: (verification: PropertyVerification) => void;
  /** Leave verification for later. The listing is saved as a draft until submitted. */
  onExit?: () => void;
}

/**
 * Step shown right after a listing is created: asks whether the host owns the
 * property, then collects the owner / non-owner (MOU) validation details and
 * submits the listing for verification.
 */
export function PropertyVerificationForm({ listingId, defaultLocation = '', onSubmitted, onExit }: Props) {
  const [ownership, setOwnership] = useState<Ownership | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [location, setLocation] = useState(defaultLocation);
  const [deedVolume, setDeedVolume] = useState('');
  const [mou, setMou] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!ownerName.trim()) e.ownerName = ownership === 'owner' ? 'Property owner name is required' : 'Actual owner name is required';
    if (!location.trim()) e.location = 'Property location is required';
    if (!deedVolume.trim()) e.deedVolume = 'Deed volume number is required';
    if (ownership === 'non_owner' && !mou) e.mou = 'A notarized MOU is required when you are not the owner';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!ownership || !validate()) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('listing', String(listingId));
      fd.append('ownership_type', ownership);
      fd.append('owner_name', ownerName.trim());
      fd.append('property_location', location.trim());
      fd.append('deed_volume_number', deedVolume.trim());
      if (ownership === 'non_owner' && mou) fd.append('mou_document', mou);
      const verification = await propertyVerificationsAPI.create(fd);
      onSubmitted(verification);
    } catch (err) {
      const data = (err as { data?: Record<string, unknown> })?.data;
      const firstErr = data && typeof data === 'object' ? Object.values(data)[0] : null;
      toast.error(
        (Array.isArray(firstErr) ? String(firstErr[0]) : null) ||
        getErrorMessage(err, 'Could not submit your property for verification.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Step 1: ownership question -----------------------------------------
  if (!ownership) {
    return (
      <Shell>
        <h1 className="text-2xl font-semibold mb-2">Are you the owner of this property?</h1>
        <p className="text-muted-foreground mb-8">
          To publish your listing we verify ownership. Your answer decides which documents we'll ask for.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" onClick={() => setOwnership('owner')}>Yes, I'm the owner</Button>
          <Button size="lg" variant="outline" onClick={() => setOwnership('non_owner')}>
            No, I manage it for the owner
          </Button>
        </div>
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="mt-6 text-sm text-muted-foreground hover:text-foreground underline"
          >
            Save as draft &amp; finish later
          </button>
        )}
      </Shell>
    );
  }

  // ---- Step 2: validation form --------------------------------------------
  const isOwner = ownership === 'owner';
  return (
    <Shell>
      <button
        type="button"
        onClick={() => setOwnership(null)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <h1 className="text-2xl font-semibold mb-1 text-center">
        {isOwner ? 'Property Owner Verification' : 'Non-Owner (MOU) Verification'}
      </h1>
      <p className="text-muted-foreground mb-6 text-center">
        {isOwner
          ? 'Confirm the ownership details for this property.'
          : 'Provide the actual owner’s details and upload your notarized MOU.'}
      </p>

      <div className="space-y-5 text-left">
        <Field
          id="pv-owner"
          label={isOwner ? 'Property Owner Name' : 'Actual Owner Name'}
          value={ownerName}
          onChange={(v) => { setOwnerName(v); setErrors((p) => ({ ...p, ownerName: '' })); }}
          error={errors.ownerName}
        />
        <Field
          id="pv-location"
          label="Property Location"
          value={location}
          onChange={(v) => { setLocation(v); setErrors((p) => ({ ...p, location: '' })); }}
          error={errors.location}
        />
        <Field
          id="pv-deed"
          label="Deed Volume Number"
          value={deedVolume}
          onChange={(v) => { setDeedVolume(v); setErrors((p) => ({ ...p, deedVolume: '' })); }}
          error={errors.deedVolume}
        />

        {!isOwner && (
          <div className="space-y-1.5">
            <Label htmlFor="pv-mou">Notarized MOU <span className="text-destructive">*</span></Label>
            <label
              htmlFor="pv-mou"
              className={[
                'flex items-center gap-3 cursor-pointer border-2 border-dashed rounded-xl px-4 py-4 transition-colors',
                errors.mou ? 'border-destructive' : 'border-border hover:border-primary',
              ].join(' ')}
            >
              <Upload className="w-5 h-5 text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground truncate">
                {mou ? mou.name : 'Upload the notarized MOU (PDF or image)'}
              </span>
              <input
                id="pv-mou"
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => { setMou(e.target.files?.[0] ?? null); setErrors((p) => ({ ...p, mou: '' })); }}
              />
            </label>
            {errors.mou && <p className="text-xs text-destructive">{errors.mou}</p>}
          </div>
        )}

        <Button size="lg" className="w-full" disabled={submitting} onClick={submit}>
          {submitting ? 'Submitting…' : 'Submit for verification'}
        </Button>
      </div>
    </Shell>
  );
}

function Field({ id, label, value, onChange, error }: {
  id: string; label: string; value: string; onChange: (v: string) => void; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label} <span className="text-destructive">*</span></Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={error ? 'border-destructive' : ''} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-8 text-center shadow-sm">{children}</div>
      </div>
    </div>
  );
}
