import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Flame, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { rbacAPI } from '../../services/api/rbac';
import type { BreakGlassSession } from '../../services/api/rbac';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { getErrorMessage } from '../../services/api/shared/errors';

export function AdminBreakGlass() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<BreakGlassSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('2');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setSessions(await rbacAPI.listBreakGlass());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to load break-glass sessions'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const request = async () => {
    if (!reason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    setBusy(true);
    try {
      await rbacAPI.requestBreakGlass(reason.trim(), Number(hours) || 2);
      toast.success('Break-glass access granted. Every request you make during this window is fully audited.');
      setReason('');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to request break-glass access'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: number) => {
    try {
      await rbacAPI.revokeBreakGlass(id);
      toast.success('Session revoked.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to revoke'));
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Flame className="h-5 w-5" /> Break-Glass Access</h1>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Temporary full-access elevation for engineers during an incident. While active, you can act as a
        full admin anywhere in the dashboard. It auto-expires (default 2 hours, max 8) and every request
        you make during the window is logged to the audit trail in full — not literal keystroke capture
        (not achievable server-side), but a complete request-level record of everything done.
      </p>

      <Card>
        <CardHeader><CardTitle>Request break-glass access</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Requires the Engineering role. Only visible to you unless you also hold RBAC Engine access.</p>
          <Textarea placeholder="Reason (required — what incident is this for?)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          <div className="flex items-center gap-2">
            <Input type="number" min="1" max="8" className="w-24" value={hours} onChange={(e) => setHours(e.target.value)} />
            <span className="text-sm text-muted-foreground">hours (max 8)</span>
            <Button size="sm" disabled={busy} onClick={request} className="ml-auto">Request access</Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sessions</h2>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No break-glass sessions.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.username}</span>
                      {s.is_active ? <Badge variant="destructive">active</Badge> : <Badge variant="outline">ended</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{s.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Granted {new Date(s.granted_at).toLocaleString()} · expires {new Date(s.expires_at).toLocaleString()}
                      {s.revoked_at && ` · revoked by ${s.revoked_by_username} at ${new Date(s.revoked_at).toLocaleString()}`}
                    </p>
                  </div>
                  {s.is_active && (
                    <Button size="sm" variant="outline" className="text-destructive shrink-0" onClick={() => revoke(s.id)}>Revoke</Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
