import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ShieldQuestion } from 'lucide-react';
import { toast } from 'sonner';
import { aircoverClaimsAPI } from '../../services/api/aircoverClaims';
import type { AirCoverClaim } from '../../services/api/aircoverClaims';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { formatCurrency } from '../../core/utils';
import { getErrorMessage } from '../../services/api/shared/errors';

const statusColor: Record<string, string> = {
  submitted: 'bg-yellow-100 text-yellow-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-primary/10 text-primary',
  denied: 'bg-red-100 text-red-600',
  paid: 'bg-green-100 text-green-700',
};

function ClaimCard({ claim, onDecided }: { claim: AirCoverClaim; onDecided: () => void }) {
  const [notes, setNotes] = useState('');
  const [approvedAmount, setApprovedAmount] = useState(claim.requested_amount);
  const [busy, setBusy] = useState(false);

  const decide = async (decision: 'approved' | 'denied') => {
    setBusy(true);
    try {
      await aircoverClaimsAPI.adminDecide(claim.id, decision, notes.trim(), decision === 'approved' ? approvedAmount : undefined);
      toast.success(decision === 'approved' ? 'Claim approved. Finance still needs to manually issue the disbursement.' : 'Claim denied.');
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
          <CardTitle className="text-base">{claim.claim_type_display} — {claim.listing_title}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Filed by {claim.claimant_username} on booking #{claim.booking} · requested {formatCurrency(Number(claim.requested_amount))}
          </p>
        </div>
        <Badge className={statusColor[claim.status]}>{claim.status_display}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm whitespace-pre-wrap">{claim.description}</p>
        {claim.status !== 'submitted' && claim.status !== 'under_review' ? (
          <p className="text-xs text-muted-foreground">
            {claim.status_display} by {claim.reviewed_by_username} — {claim.review_notes}
            {claim.approved_amount && ` (approved amount: ${formatCurrency(Number(claim.approved_amount))})`}
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Approved amount</label>
                <Input className="w-32" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
              </div>
              <Textarea placeholder="Review notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} className="flex-1 min-w-[200px]" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => decide('approved')}>Approve</Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide('denied')}>Deny</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Approving records the amount only — it doesn't move money. Issue the actual payment via the
              Finance & Legal Center's refund tools, referencing this claim.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminAircoverClaims() {
  const navigate = useNavigate();
  const [claims, setClaims] = useState<AirCoverClaim[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setClaims(await aircoverClaimsAPI.adminList(statusFilter === 'all' ? undefined : statusFilter));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have customer_support.aircover_claims access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldQuestion className="h-5 w-5" /> AirCover Claims</h1>
      </div>

      <Select value={statusFilter} onValueChange={setStatusFilter}>
        <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="submitted">Submitted</SelectItem>
          <SelectItem value="under_review">Under review</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="denied">Denied</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
        </SelectContent>
      </Select>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : claims.length === 0 ? (
        <p className="text-sm text-muted-foreground">No claims in this status.</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {claims.map((c) => <ClaimCard key={c.id} claim={c} onDecided={load} />)}
        </div>
      )}
    </div>
  );
}
