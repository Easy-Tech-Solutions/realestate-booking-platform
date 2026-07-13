import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ShieldCheck, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { rbacAPI } from '../../services/api/rbac';
import type { PendingApproval } from '../../services/api/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getErrorMessage } from '../../services/api/shared/errors';

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-primary/10 text-primary',
  rejected: 'bg-red-100 text-red-600',
};

const ACTION_LABELS: Record<string, string> = {
  'payment.refund': 'Refund payment',
  'user.suspend': 'Suspend user',
};

function ApprovalCard({ approval, onDecided }: { approval: PendingApproval; onDecided: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    try {
      await rbacAPI.approveRequest(approval.id);
      toast.success('Approved and executed.');
      onDecided();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to approve'));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    try {
      await rbacAPI.rejectRequest(approval.id, reason.trim());
      toast.success('Rejected.');
      onDecided();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to reject'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base">{ACTION_LABELS[approval.action_key] || approval.action_key}</CardTitle>
          <p className="text-sm text-muted-foreground">Requested by {approval.requested_by_username} · {new Date(approval.created_at).toLocaleString()}</p>
        </div>
        <Badge className={statusColor[approval.status]}>{approval.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{approval.request_reason}</p>
        <div className="rounded-md bg-muted/50 p-3 text-xs font-mono overflow-x-auto">
          {JSON.stringify(approval.payload, null, 2)}
        </div>
        {approval.status !== 'pending' && (
          <p className="text-xs text-muted-foreground">
            Decided by {approval.decided_by_username} · {approval.decided_at && new Date(approval.decided_at).toLocaleString()}
            {approval.execution_error && <span className="block text-destructive mt-1">Execution error: {approval.execution_error}</span>}
          </p>
        )}
        {approval.status === 'pending' && (
          <>
            <Textarea placeholder="Rejection reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={approve}><Check className="h-3.5 w-3.5 mr-1" /> Approve & execute</Button>
              <Button size="sm" variant="destructive" disabled={busy} onClick={reject}><X className="h-3.5 w-3.5 mr-1" /> Reject</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminApprovals() {
  const navigate = useNavigate();
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setApprovals(await rbacAPI.listApprovals(statusFilter));
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load approvals'));
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
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Pending Approvals</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Actions requiring dual authorization (four-eyes) — a refund over $500, or suspending a host with
        more than 3 published listings — land here instead of executing immediately. A different admin
        than the one who requested it must approve before it runs.
      </p>

      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
        <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : approvals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No requests in this status.</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {approvals.map((a) => <ApprovalCard key={a.id} approval={a} onDecided={load} />)}
        </div>
      )}
    </div>
  );
}
