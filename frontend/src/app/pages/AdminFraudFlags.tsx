import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ShieldAlert, Sparkles, RadioTower, MapPinOff, Fingerprint, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { trustSafetyAPI } from '../../services/api/trustsafety';
import type { FraudFlag, BlockedFingerprint, BlacklistedLocation } from '../../services/api/trustsafety';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getErrorMessage } from '../../services/api/shared/errors';

// Flags are created instantly by the rule-based detectors in
// trustsafety/detection.py; the AI text-signal score is filled in
// asynchronously a few seconds later by a local LLM (or stays blank if an
// admin has turned ai_scoring_enabled off in Platform Settings).
function AiScoreBadge({ score, rationale }: { score: number | null; rationale: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      title={rationale || undefined}
    >
      <Sparkles className="h-3 w-3" /> {score === null ? 'AI risk score: pending / disabled' : `AI risk score: ${Math.round(score)}`}
    </span>
  );
}

const severityColor: Record<string, string> = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-red-100 text-red-600',
};

function FraudFlagCard({ flag, onDecided }: { flag: FraudFlag; onDecided: () => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'dismissed' | 'confirmed') => {
    setBusy(true);
    try {
      await trustSafetyAPI.reviewFraudFlag(flag.id, decision, notes.trim());
      toast.success(decision === 'confirmed' ? 'Marked as confirmed fraud.' : 'Dismissed.');
      onDecided();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to record decision'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">{flag.flag_type_display}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {flag.user_username ? `${flag.user_username} · ${flag.user_email}` : 'Not tied to a single account'}
          </p>
        </div>
        <Badge className={severityColor[flag.severity]}>{flag.severity}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <AiScoreBadge score={flag.ai_score} rationale={flag.ai_rationale} />
        <p className="text-sm whitespace-pre-wrap">{flag.details}</p>
        <Textarea
          placeholder="Review notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide('confirmed')}>Confirm fraud</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('dismissed')}>Dismiss</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BlockedFingerprintsPanel() {
  const [items, setItems] = useState<BlockedFingerprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [fingerprint, setFingerprint] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await trustSafetyAPI.listBlockedFingerprints());
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load blocked fingerprints'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!fingerprint.trim()) {
      toast.error('A fingerprint value is required.');
      return;
    }
    setBusy(true);
    try {
      await trustSafetyAPI.blockFingerprint(fingerprint.trim(), reason.trim());
      setFingerprint('');
      setReason('');
      toast.success('Device fingerprint blocked.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to block fingerprint'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await trustSafetyAPI.unblockFingerprint(id);
      toast.success('Unblocked.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to unblock'));
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Fingerprint className="h-4 w-4" /> Blocked device fingerprints</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Blocks registration, Google sign-in, and password login from a matching device — the
          frontend computes and sends <code className="mx-1">X-Device-Fingerprint</code> on all
          three, and the backend rejects the request if it matches a block below.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="Fingerprint value" value={fingerprint} onChange={(e) => setFingerprint(e.target.value)} />
          <Input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button disabled={busy} onClick={add}>Block</Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fingerprints blocked.</p>
        ) : (
          <div className="space-y-2">
            {items.map((fp) => (
              <div key={fp.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-mono">{fp.fingerprint}</p>
                  <p className="text-xs text-muted-foreground">{fp.reason || '—'} · blocked by {fp.blocked_by_username || 'system'}</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(fp.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BlacklistedLocationsPanel() {
  const [items, setItems] = useState<BlacklistedLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState('0.2');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems(await trustSafetyAPI.listBlacklistedLocations());
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load blacklisted locations'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const add = async () => {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!name.trim() || Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      toast.error('Name, latitude, and longitude are required.');
      return;
    }
    setBusy(true);
    try {
      await trustSafetyAPI.blacklistLocation(name.trim(), latNum, lngNum, parseFloat(radius) || 0.2, reason.trim());
      setName(''); setLat(''); setLng(''); setRadius('0.2'); setReason('');
      toast.success('Location blacklisted.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to blacklist location'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await trustSafetyAPI.removeBlacklistedLocation(id);
      toast.success('Removed.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove'));
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><MapPinOff className="h-4 w-4" /> Blacklisted locations</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Blocks new listings within a radius of a coordinate — e.g. a known problem address —
          regardless of which account tries to list it.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <Input placeholder="Internal label / reason for the ban" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Input placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
          <Input placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
          <Input placeholder="Radius (km)" value={radius} onChange={(e) => setRadius(e.target.value)} />
        </div>
        <Button disabled={busy} onClick={add}>Add to blacklist</Button>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No locations blacklisted.</p>
        ) : (
          <div className="space-y-2">
            {items.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{loc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {loc.latitude}, {loc.longitude} · {loc.radius_km} km · {loc.reason || '—'}
                  </p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => remove(loc.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminFraudFlags() {
  const navigate = useNavigate();
  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [statusFilter, setStatusFilter] = useState<'open' | 'dismissed' | 'confirmed' | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = async (status = statusFilter) => {
    setLoading(true);
    try {
      setFlags(await trustSafetyAPI.listFraudFlags(status));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have Trust & Safety access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(statusFilter); }, [statusFilter]);

  const runScan = async () => {
    setScanning(true);
    try {
      const result = await trustSafetyAPI.scanForFraud();
      toast.success(`Scan complete — ${result.created} new flag(s) created.`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Scan failed'));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Fraud & AML</h1>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Fraud flags</h2>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={scanning} onClick={runScan}>
              <RadioTower className="h-3.5 w-3.5 mr-1" /> {scanning ? 'Scanning…' : 'Run detectors'}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Flags are generated by rule-based detectors (rapid signups from one IP, cards reused across
          accounts). Each flag is then scored by a local AI model for a text-signal risk score —
          it reads the detector evidence, not any documents or images.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No flags in this status.</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            {flags.map((f) => <FraudFlagCard key={f.id} flag={f} onDecided={() => load()} />)}
          </div>
        )}
      </section>

      <section className="grid lg:grid-cols-2 gap-6">
        <BlockedFingerprintsPanel />
        <BlacklistedLocationsPanel />
      </section>
    </div>
  );
}
