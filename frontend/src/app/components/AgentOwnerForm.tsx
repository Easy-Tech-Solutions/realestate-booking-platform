import React, { useState } from 'react';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from './ui/select';

export interface AgentOwnerDetails {
  name: string;
  phone: string;
  email: string;
  payoutNumber: string;
  payoutNetwork: string;
}

interface Props {
  onBack: () => void;
  onSubmit: (details: AgentOwnerDetails) => void;
  submitting?: boolean;
}

/**
 * Owner-details step shown to a sourcing agent before submitting a property.
 * The agent lists on the owner's behalf; payment goes to the owner's number,
 * and the agent attests the owner consented. Home Konet verifies by phone.
 */
export function AgentOwnerForm({ onBack, onSubmit, submitting }: Props) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [payoutNumber, setPayoutNumber] = useState('');
  const [payoutNetwork, setPayoutNetwork] = useState('mtn');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "The owner's name is required";
    if (!phone.trim()) e.phone = "The owner's phone number is required";
    if (!payoutNumber.trim()) e.payoutNumber = "The owner's payout (MoMo) number is required";
    if (!consent) e.consent = 'You must confirm the owner consented to this listing';
    setErrors(e);
    if (Object.keys(e).length) return;
    onSubmit({ name: name.trim(), phone: phone.trim(), email: email.trim(), payoutNumber: payoutNumber.trim(), payoutNetwork });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-5">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-primary" />
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <h1 className="text-2xl font-semibold mb-1 text-center">Property owner details</h1>
          <p className="text-muted-foreground mb-6 text-center text-sm">
            You’re listing on the owner’s behalf. Bookings pay out to the owner’s number; Home Konet
            verifies these details with the owner before publishing.
          </p>

          <div className="space-y-4">
            <Field id="ao-name" label="Owner's full name" value={name} error={errors.name}
              onChange={(v) => { setName(v); setErrors((p) => ({ ...p, name: '' })); }} />
            <Field id="ao-phone" label="Owner's phone number" value={phone} error={errors.phone}
              onChange={(v) => { setPhone(v); setErrors((p) => ({ ...p, phone: '' })); }} />
            <div className="space-y-1.5">
              <Label htmlFor="ao-email">Owner's email <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input id="ao-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Field id="ao-payout" label="Owner's payout (MoMo) number" value={payoutNumber} error={errors.payoutNumber}
              onChange={(v) => { setPayoutNumber(v); setErrors((p) => ({ ...p, payoutNumber: '' })); }} />
            <div className="space-y-1.5">
              <Label>Payout network</Label>
              <Select value={payoutNetwork} onValueChange={setPayoutNetwork}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mtn">MTN Mobile Money</SelectItem>
                  <SelectItem value="orange">Orange Money</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={consent}
                onChange={(e) => { setConsent(e.target.checked); setErrors((p) => ({ ...p, consent: '' })); }}
                className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary shrink-0" />
              <span className="text-sm text-foreground">I confirm the owner consented to having this property listed on Home Konet.</span>
            </label>
            {errors.consent && <p className="text-xs text-destructive">{errors.consent}</p>}

            <Button size="lg" className="w-full" disabled={submitting || !consent} onClick={submit}>
              {submitting ? 'Submitting…' : 'Submit for verification'}
            </Button>
          </div>
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
