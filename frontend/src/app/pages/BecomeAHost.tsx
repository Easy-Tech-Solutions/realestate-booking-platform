import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle, Clock, XCircle, Loader2, ShieldCheck, Upload } from 'lucide-react';
import { useApp } from '../../hooks/useApp';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { hostApplicationsAPI, type HostApplication } from '../../services/api/hostApplications';
import { getErrorMessage } from '../../services/api/shared/errors';

const STAGES = [
  { key: 'product_support', label: 'Product Support' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'supervisor', label: 'Supervisor' },
];

interface FormState {
  fullName: string;
  address: string;
  phone: string;
}

const INITIAL_FORM: FormState = { fullName: '', address: '', phone: '' };

export function BecomeAHost() {
  const navigate = useNavigate();
  const { user } = useApp();

  const [loading, setLoading] = useState(true);
  const [application, setApplication] = useState<HostApplication | null>(null);
  const [reapplying, setReapplying] = useState(false);

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [headshot, setHeadshot] = useState<File | null>(null);
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | 'headshot' | 'idDocument' | 'agreement', string>>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    hostApplicationsAPI
      .getMine()
      .then((app) => { if (active) setApplication(app); })
      .catch(() => { /* treat as no application */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const set = (field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validate = (): boolean => {
    const errs: typeof errors = {};
    if (!form.fullName.trim()) errs.fullName = 'Full name is required';
    if (!form.address.trim()) errs.address = 'Address is required';
    if (!form.phone.trim()) errs.phone = 'Phone number is required';
    if (!headshot) errs.headshot = 'A headshot / passport photo is required';
    if (!idDocument) errs.idDocument = 'A photo of your national ID / passport is required';
    if (!agreed) errs.agreement = 'You must agree to the Property Owner Agreement to continue';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload = new FormData();
      payload.append('full_name', form.fullName.trim());
      payload.append('address', form.address.trim());
      payload.append('phone', form.phone.trim());
      if (headshot) payload.append('headshot', headshot);
      if (idDocument) payload.append('id_document', idDocument);
      payload.append('agreement_accepted', 'true');

      const created = await hostApplicationsAPI.create(payload);
      setApplication(created);
      setReapplying(false);
      setForm(INITIAL_FORM);
      setHeadshot(null);
      setIdDocument(null);
      setAgreed(false);
      toast.success('Application submitted — we’ll review it shortly.');
    } catch (err: unknown) {
      const data = (err as { data?: { non_field_errors?: string[] } })?.data;
      toast.error(data?.non_field_errors?.[0] || getErrorMessage(err, 'Failed to submit your application.'));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Loading ------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ---- Already a host -----------------------------------------------------
  if (user?.isHost || application?.status === 'approved') {
    return (
      <StatusShell icon={<CheckCircle className="w-16 h-16 text-green-500" />} title="You're a host!">
        <p className="text-muted-foreground mb-8">
          Your account has host access. You can start listing your properties now.
        </p>
        <Button size="lg" onClick={() => navigate('/host/new')}>List a property</Button>
      </StatusShell>
    );
  }

  // ---- Application under review -------------------------------------------
  const isUnderReview =
    application && ['submitted', 'ps_approved', 'compliance_approved'].includes(application.status);

  if (isUnderReview && !reapplying) {
    const currentIdx = STAGES.findIndex((s) => s.key === application!.current_stage);
    return (
      <StatusShell icon={<Clock className="w-16 h-16 text-amber-500" />} title="Application under review">
        <p className="text-muted-foreground mb-8">
          Thanks, {application!.full_name.split(' ')[0]}. Our team is reviewing your application.
          You’ll get an email at <span className="font-medium text-foreground">{application!.email}</span> at
          each step.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6 mb-2">
          {STAGES.map((stage, idx) => {
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            return (
              <div key={stage.key} className="flex items-center gap-2">
                <span
                  className={[
                    'flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold border shrink-0',
                    done ? 'bg-green-500 border-green-500 text-white'
                      : active ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-muted border-border text-muted-foreground',
                  ].join(' ')}
                >
                  {done ? '✓' : idx + 1}
                </span>
                <span className={`whitespace-nowrap text-sm ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                  {stage.label}
                </span>
              </div>
            );
          })}
        </div>
      </StatusShell>
    );
  }

  // ---- Declined (offer re-apply) ------------------------------------------
  const wasDeclined = application?.status === 'declined' && !reapplying;
  if (wasDeclined) {
    return (
      <StatusShell icon={<XCircle className="w-16 h-16 text-destructive" />} title="Application not approved">
        {application!.decline_reason ? (
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 text-left mb-6">
            <p className="text-sm font-medium text-foreground mb-1">Reason</p>
            <p className="text-sm text-muted-foreground">{application!.decline_reason}</p>
          </div>
        ) : null}
        <p className="text-muted-foreground mb-8">
          You’re welcome to submit a new application addressing the feedback above.
        </p>
        <Button size="lg" onClick={() => setReapplying(true)}>Apply again</Button>
      </StatusShell>
    );
  }

  // ---- Application form ----------------------------------------------------
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary py-16 px-4 text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-white/10 rounded-full p-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-semibold text-white mb-3">Become a host</h1>
        <p className="text-white/80 text-lg max-w-md mx-auto">
          Tell us about yourself and verify your identity. Our team reviews every application to keep
          HomeKonet safe and trustworthy.
        </p>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12 max-w-2xl">
        <div className="bg-card border border-border rounded-xl shadow-sm p-8">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Full name */}
            <div className="space-y-1.5">
              <Label htmlFor="ha-name">Full name <span className="text-destructive">*</span></Label>
              <Input
                id="ha-name"
                placeholder="Your legal full name"
                value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)}
                className={errors.fullName ? 'border-destructive' : ''}
              />
              {errors.fullName && <p className="text-xs text-destructive">{errors.fullName}</p>}
            </div>

            {/* Address */}
            <div className="space-y-1.5">
              <Label htmlFor="ha-address">Address <span className="text-destructive">*</span></Label>
              <Input
                id="ha-address"
                placeholder="Street, city, county"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
                className={errors.address ? 'border-destructive' : ''}
              />
              {errors.address && <p className="text-xs text-destructive">{errors.address}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Phone */}
              <div className="space-y-1.5">
                <Label htmlFor="ha-phone">Phone number <span className="text-destructive">*</span></Label>
                <Input
                  id="ha-phone"
                  placeholder="0880 000 000"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  className={errors.phone ? 'border-destructive' : ''}
                />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone}</p>}
              </div>

              {/* Email (read-only) */}
              <div className="space-y-1.5">
                <Label htmlFor="ha-email">Email</Label>
                <Input id="ha-email" type="email" value={user?.email ?? ''} readOnly disabled />
                <p className="text-xs text-muted-foreground">Linked to your account</p>
              </div>
            </div>

            <FileField
              id="ha-headshot"
              label="Headshot / passport-sized photo"
              file={headshot}
              error={errors.headshot}
              onSelect={(f) => { setHeadshot(f); setErrors((p) => ({ ...p, headshot: '' })); }}
            />
            <FileField
              id="ha-id"
              label="Photo of national ID / passport"
              file={idDocument}
              error={errors.idDocument}
              onSelect={(f) => { setIdDocument(f); setErrors((p) => ({ ...p, idDocument: '' })); }}
            />

            {/* Property Owner Agreement */}
            <div className="pt-1 border-t border-border">
              <p className="text-sm text-muted-foreground mt-4 mb-3">
                By submitting this application, you agree to the Home Konet{' '}
                <Link
                  to="/property-owner-agreement"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary font-medium hover:underline"
                >
                  Property Owner Agreement
                </Link>
                .
              </p>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => { setAgreed(e.target.checked); setErrors((p) => ({ ...p, agreement: '' })); }}
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
                  </Link>
                  .
                </span>
              </label>
              {errors.agreement && <p className="text-xs text-destructive mt-1">{errors.agreement}</p>}
            </div>

            <Button type="submit" className="w-full" disabled={submitting || !agreed} size="lg">
              {submitting ? 'Submitting...' : 'Submit application'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              By submitting you confirm the information is accurate. Need help?{' '}
              <Link to="/contact" className="text-primary font-medium hover:underline">Contact us</Link>.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function FileField({
  id, label, file, error, onSelect,
}: {
  id: string;
  label: string;
  file: File | null;
  error?: string;
  onSelect: (f: File | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label} <span className="text-destructive">*</span></Label>
      <label
        htmlFor={id}
        className={[
          'flex items-center gap-3 cursor-pointer border-2 border-dashed rounded-xl px-4 py-4 transition-colors',
          error ? 'border-destructive' : 'border-border hover:border-primary',
        ].join(' ')}
      >
        <Upload className="w-5 h-5 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground truncate">
          {file ? file.name : 'Click to upload an image'}
        </span>
        <input
          id={id}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function StatusShell({
  icon, title, children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-16 max-w-xl">
        <div className="bg-card border border-border rounded-xl p-10 text-center shadow-sm">
          <div className="flex justify-center mb-5">{icon}</div>
          <h1 className="text-2xl font-semibold mb-3">{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}
