import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CheckCircle, Clock, XCircle, Loader2, Handshake, Upload } from 'lucide-react';
import { useApp } from '../../hooks/useApp';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { agentsAPI, type AgentApplicationState } from '../../services/api/agents';
import { getErrorMessage } from '../../services/api/shared/errors';

const STAGES = [
  { key: 'product_support', label: 'Product Support' },
  { key: 'compliance', label: 'Compliance' },
  { key: 'supervisor', label: 'Supervisor' },
];

export function BecomeAgent() {
  const navigate = useNavigate();
  const { user } = useApp();

  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<AgentApplicationState | null>(null);
  const [reapplying, setReapplying] = useState(false);

  const [fullName, setFullName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    agentsAPI.getMyApplication()
      .then((s) => { if (active) setState(s); })
      .catch(() => { /* treat as none */ })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!fullName.trim()) e.fullName = 'Full name is required';
    if (!address.trim()) e.address = 'Address is required';
    if (!phone.trim()) e.phone = 'Phone number is required';
    if (!idDoc) e.idDoc = 'A photo of your national ID / passport is required';
    if (!agreed) e.agreement = 'You must agree to the Agent Agreement to continue';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('full_name', fullName.trim());
      fd.append('address', address.trim());
      fd.append('phone', phone.trim());
      if (idDoc) fd.append('id_document', idDoc);
      fd.append('agreement_accepted', 'true');
      const created = await agentsAPI.apply(fd);
      setState({ is_agent: false, application: created });
      setReapplying(false);
      toast.success('Application submitted — we’ll review it shortly.');
    } catch (err: unknown) {
      const data = (err as { data?: { non_field_errors?: string[] } })?.data;
      toast.error(data?.non_field_errors?.[0] || getErrorMessage(err, 'Failed to submit your application.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  const app = state?.application;

  // Already an approved agent
  if (state?.is_agent || app?.status === 'approved') {
    return (
      <Shell icon={<CheckCircle className="w-16 h-16 text-green-500" />} title="You're an approved agent!">
        <p className="text-muted-foreground mb-8">You can source properties on owners’ behalf and earn commission on their bookings.</p>
        <Button size="lg" onClick={() => navigate('/agent')}>Go to Agent Dashboard</Button>
      </Shell>
    );
  }

  const underReview = app && ['submitted', 'ps_approved', 'compliance_approved'].includes(app.status);
  if (underReview && !reapplying) {
    const idx = STAGES.findIndex((s) => s.key === app!.current_stage);
    return (
      <Shell icon={<Clock className="w-16 h-16 text-amber-500" />} title="Application under review">
        <p className="text-muted-foreground mb-8">
          Thanks, {app!.full_name.split(' ')[0]}. Our team is reviewing your application. You’ll get an
          email at <span className="font-medium text-foreground">{app!.email}</span> at each step.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center sm:gap-6">
          {STAGES.map((stage, i) => {
            const done = i < idx, active = i === idx;
            return (
              <div key={stage.key} className="flex items-center gap-2">
                <span className={['flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold border shrink-0',
                  done ? 'bg-green-500 border-green-500 text-white'
                    : active ? 'bg-primary border-primary text-primary-foreground'
                    : 'bg-muted border-border text-muted-foreground'].join(' ')}>{done ? '✓' : i + 1}</span>
                <span className={`text-sm ${active ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>{stage.label}</span>
              </div>
            );
          })}
        </div>
      </Shell>
    );
  }

  if (app?.status === 'declined' && !reapplying) {
    return (
      <Shell icon={<XCircle className="w-16 h-16 text-destructive" />} title="Application not approved">
        {app.decline_reason ? (
          <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-4 text-left mb-6">
            <p className="text-sm font-medium text-foreground mb-1">Reason</p>
            <p className="text-sm text-muted-foreground">{app.decline_reason}</p>
          </div>
        ) : null}
        <p className="text-muted-foreground mb-8">You’re welcome to submit a new application addressing the feedback above.</p>
        <Button size="lg" onClick={() => setReapplying(true)}>Apply again</Button>
      </Shell>
    );
  }

  // Application form
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary py-16 px-4 text-center">
        <div className="flex justify-center mb-4"><div className="bg-white/10 rounded-full p-4"><Handshake className="w-8 h-8 text-white" /></div></div>
        <h1 className="text-4xl font-semibold text-white mb-3">Become an agent</h1>
        <p className="text-white/80 text-lg max-w-md mx-auto">
          Source properties for owners and earn commission on every booking — Home Konet handles
          verification, tenants, and payments. You just find great properties.
        </p>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12 max-w-2xl">
        <div className="bg-card border border-border rounded-xl shadow-sm p-8">
          <form onSubmit={submit} noValidate className="space-y-5">
            <Field id="ag-name" label="Full name" value={fullName} error={errors.fullName}
              onChange={(v) => { setFullName(v); setErrors((p) => ({ ...p, fullName: '' })); }} />
            <Field id="ag-address" label="Address" value={address} error={errors.address}
              onChange={(v) => { setAddress(v); setErrors((p) => ({ ...p, address: '' })); }} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <Field id="ag-phone" label="Phone number" value={phone} error={errors.phone}
                onChange={(v) => { setPhone(v); setErrors((p) => ({ ...p, phone: '' })); }} />
              <div className="space-y-1.5">
                <Label htmlFor="ag-email">Email</Label>
                <Input id="ag-email" type="email" value={user?.email ?? ''} readOnly disabled />
                <p className="text-xs text-muted-foreground">Linked to your account</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ag-id">Photo of national ID / passport <span className="text-destructive">*</span></Label>
              <label htmlFor="ag-id" className={['flex items-center gap-3 cursor-pointer border-2 border-dashed rounded-xl px-4 py-4 transition-colors',
                errors.idDoc ? 'border-destructive' : 'border-border hover:border-primary'].join(' ')}>
                <Upload className="w-5 h-5 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground truncate">{idDoc ? idDoc.name : 'Click to upload an image'}</span>
                <input id="ag-id" type="file" accept="image/*" className="hidden"
                  onChange={(e) => { setIdDoc(e.target.files?.[0] ?? null); setErrors((p) => ({ ...p, idDoc: '' })); }} />
              </label>
              {errors.idDoc && <p className="text-xs text-destructive">{errors.idDoc}</p>}
            </div>

            <div className="pt-1 border-t border-border">
              <label className="flex items-start gap-3 cursor-pointer mt-4">
                <input type="checkbox" checked={agreed}
                  onChange={(e) => { setAgreed(e.target.checked); setErrors((p) => ({ ...p, agreement: '' })); }}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary shrink-0" />
                <span className="text-sm text-foreground">I have read and agree to the Home Konet Agent Agreement.</span>
              </label>
              {errors.agreement && <p className="text-xs text-destructive mt-1">{errors.agreement}</p>}
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={submitting || !agreed}>
              {submitting ? 'Submitting…' : 'Submit application'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Need help? <Link to="/contact" className="text-primary font-medium hover:underline">Contact us</Link>.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, value, onChange, error }: { id: string; label: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label} <span className="text-destructive">*</span></Label>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={error ? 'border-destructive' : ''} />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function Shell({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
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
