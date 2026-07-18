import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ShieldCheck, Sparkles, FileText, ImageIcon } from 'lucide-react';
import { toast } from 'sonner';
import { hostApplicationsAPI } from '../../services/api/hostApplications';
import { propertyVerificationsAPI } from '../../services/api/propertyVerifications';
import type { HostApplication } from '../../services/api/hostApplications';
import type { PropertyVerification } from '../../services/api/propertyVerifications';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { getErrorMessage } from '../../services/api/shared/errors';

// Scored asynchronously by a local text-only LLM reading the submitted name/
// address/phone/ownership fields — it never inspects the ID/headshot/MOU/
// inspection document images themselves. Still always manual-review-only;
// this is a pre-screen signal, not an approval.
function AiPreScreenBadge({ score, rationale }: { score: number | null | undefined; rationale: string | undefined }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
      title={rationale || undefined}
    >
      <Sparkles className="h-3 w-3" />
      {score == null ? 'AI pre-screen: pending / disabled' : `AI pre-screen score: ${Math.round(score)} (text signals only)`}
    </span>
  );
}

function HostApplicationCard({ app, onDecided }: { app: HostApplication; onDecided: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const decide = async (approve: boolean) => {
    if (!approve && !reason.trim()) {
      toast.error('A reason is required when declining.');
      return;
    }
    setBusy(true);
    try {
      await hostApplicationsAPI.review(app.id, approve, reason.trim());
      toast.success(approve ? 'Approved — advanced to the next stage.' : 'Declined.');
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
          <CardTitle className="text-base">{app.full_name}</CardTitle>
          <p className="text-sm text-muted-foreground">{app.email} · {app.phone}</p>
          <p className="text-sm text-muted-foreground">{app.address}</p>
        </div>
        <Badge variant="secondary">{app.status_display}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <AiPreScreenBadge score={app.ai_risk_score} rationale={app.ai_rationale} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><ImageIcon className="h-3 w-3" /> Headshot</p>
            {app.headshot_url ? (
              <a href={app.headshot_url} target="_blank" rel="noopener noreferrer">
                <img src={app.headshot_url} alt="Headshot" className="h-32 w-32 rounded-lg object-cover border border-border" />
              </a>
            ) : <p className="text-sm text-muted-foreground">Not provided</p>}
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1"><FileText className="h-3 w-3" /> ID document</p>
            {app.id_document_url ? (
              <a href={app.id_document_url} target="_blank" rel="noopener noreferrer">
                <img src={app.id_document_url} alt="ID document" className="h-32 w-32 rounded-lg object-cover border border-border" />
              </a>
            ) : <p className="text-sm text-muted-foreground">Not provided</p>}
          </div>
        </div>
        {app.tax_clearance_receipt_url && (
          <a href={app.tax_clearance_receipt_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> View Tax Clearance Receipt
          </a>
        )}
        {(app.next_of_kin_name || app.next_of_kin_phone) && (
          <div className="text-sm text-muted-foreground">
            <p className="text-xs font-medium text-foreground mb-0.5">Next of kin</p>
            {app.next_of_kin_name} ({app.next_of_kin_relationship}) · {app.next_of_kin_phone}
          </div>
        )}
        <Textarea
          placeholder="Reason (required if declining)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => decide(true)}>Approve</Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide(false)}>Decline</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PropertyVerificationCard({ v, onDecided }: { v: PropertyVerification; onDecided: () => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const isCompliance = v.current_stage === 'compliance';
  const [dueDiligenceDone, setDueDiligenceDone] = useState(false);
  const [inspectionReport, setInspectionReport] = useState<File | null>(null);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not available on this device/browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
      },
      () => toast.error('Could not read your current location.'),
    );
  };

  const decide = async (decision: 'approve' | 'reject' | 'request_correction') => {
    if (decision !== 'approve' && !notes.trim()) {
      toast.error('Notes are required when rejecting or requesting a correction.');
      return;
    }
    if (isCompliance && decision === 'approve' && (!dueDiligenceDone || !inspectionReport)) {
      toast.error('Due diligence must be confirmed and an inspection report uploaded before approving at Compliance.');
      return;
    }
    setBusy(true);
    try {
      const inspectionData = isCompliance
        ? {
            due_diligence_done: dueDiligenceDone,
            inspection_report: inspectionReport,
            inspection_latitude: latitude || undefined,
            inspection_longitude: longitude || undefined,
          }
        : undefined;
      await propertyVerificationsAPI.review(v.id, decision, notes.trim(), inspectionData);
      toast.success('Decision recorded.');
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
          <CardTitle className="text-base">{v.listing_title}</CardTitle>
          <p className="text-sm text-muted-foreground">{v.owner_name} · {v.property_location}</p>
          <p className="text-sm text-muted-foreground">Deed/volume #: {v.deed_volume_number} · {v.ownership_type === 'owner' ? 'Owner' : 'Non-owner (MOU)'}</p>
        </div>
        <Badge variant="secondary">{v.status_display}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <AiPreScreenBadge score={v.ai_risk_score} rationale={v.ai_rationale} />
        {v.mou_document_url && (
          <a href={v.mou_document_url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" /> View notarized MOU
          </a>
        )}
        {isCompliance && (
          <div className="border border-border rounded-lg p-3 space-y-3">
            <p className="text-xs font-medium text-foreground">Site inspection (required to approve at this stage)</p>
            <div className="flex items-start gap-2">
              <Checkbox
                id={`dd-${v.id}`}
                checked={dueDiligenceDone}
                onCheckedChange={(checked) => setDueDiligenceDone(checked === true)}
              />
              <Label htmlFor={`dd-${v.id}`} className="font-normal cursor-pointer">
                Due diligence / site visit completed
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`report-${v.id}`} className="text-xs">Inspection report</Label>
              <Input
                id={`report-${v.id}`}
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setInspectionReport(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={`lat-${v.id}`} className="text-xs">GPS latitude</Label>
                <Input id={`lat-${v.id}`} placeholder="5.603700" value={latitude} onChange={(e) => setLatitude(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`lng-${v.id}`} className="text-xs">GPS longitude</Label>
                <Input id={`lng-${v.id}`} placeholder="-0.186964" value={longitude} onChange={(e) => setLongitude(e.target.value)} />
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={useCurrentLocation}>Use my current location</Button>
          </div>
        )}
        <Textarea
          placeholder="Notes (required for reject / request correction)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" disabled={busy} onClick={() => decide('approve')}>Approve</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('request_correction')}>Request correction</Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide('reject')}>Reject</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminKycQueue() {
  const navigate = useNavigate();
  const [apps, setApps] = useState<HostApplication[]>([]);
  const [verifications, setVerifications] = useState<PropertyVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [verifsError, setVerifsError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [appsResult, verifsResult] = await Promise.allSettled([
      hostApplicationsAPI.reviewQueue(),
      propertyVerificationsAPI.reviewQueue(),
    ]);
    if (appsResult.status === 'fulfilled') { setApps(appsResult.value); setAppsError(null); }
    else setAppsError(getErrorMessage(appsResult.reason, 'You are not a reviewer for this queue.'));
    if (verifsResult.status === 'fulfilled') { setVerifications(verifsResult.value); setVerifsError(null); }
    else setVerifsError(getErrorMessage(verifsResult.reason, 'You are not a reviewer for this queue.'));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> KYC & Verification Review</h1>
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Host applications</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : appsError ? (
          <p className="text-sm text-muted-foreground">{appsError}</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No host applications awaiting your review.</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            {apps.map((app) => <HostApplicationCard key={app.id} app={app} onDecided={load} />)}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Property verifications</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : verifsError ? (
          <p className="text-sm text-muted-foreground">{verifsError}</p>
        ) : verifications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No property verifications awaiting your review.</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            {verifications.map((v) => <PropertyVerificationCard key={v.id} v={v} onDecided={load} />)}
          </div>
        )}
      </section>
    </div>
  );
}
