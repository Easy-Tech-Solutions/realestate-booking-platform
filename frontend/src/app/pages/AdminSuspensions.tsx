import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { suspensionsAPI } from '../../services/api.service';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { UserAutocomplete } from '../components/UserAutocomplete';
import { toast } from 'sonner';

interface SuspensionItem {
  id: number;
  username: string;
  user: number;
  suspension_type: 'temporary' | 'indefinite' | 'permanent';
  reason: string;
  status: 'active' | 'expired' | 'revoked';
  started_at: string;
  ends_at: string | null;
  related_report_id: number | null;
}

export function AdminSuspensions() {
  const [searchParams] = useSearchParams();
  const prefillReportId = searchParams.get('report');

  const [stats, setStats] = useState<any>(null);
  const [items, setItems] = useState<SuspensionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [userId, setUserId] = useState(searchParams.get('user') || '');
  const [type, setType] = useState<'temporary' | 'indefinite' | 'permanent'>('temporary');
  const [reason, setReason] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [revokeReason, setRevokeReason] = useState<Record<number, string>>({});

  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [count, setCount] = useState(0);
  const LIMIT = 20;

  const loadData = async (targetOffset = offset) => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        suspensionsAPI.stats(),
        suspensionsAPI.list({
          status: statusFilter === 'all' ? undefined : statusFilter,
          suspension_type: typeFilter === 'all' ? undefined : typeFilter,
          limit: LIMIT,
          offset: targetOffset,
        }),
      ]);
      setStats(statsRes);
      setItems(listRes.results || []);
      setCount(listRes.count ?? 0);
      setOffset(targetOffset);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load suspensions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter]);

  const createSuspension = async () => {
    if (!userId || !reason.trim()) {
      toast.error('User ID and reason are required');
      return;
    }

    if (type === 'temporary' && !endsAt) {
      toast.error('End date is required for temporary suspensions');
      return;
    }

    setCreating(true);
    try {
      const result = await suspensionsAPI.create({
        user: Number(userId),
        suspension_type: type,
        reason,
        ends_at: type === 'temporary' ? new Date(endsAt).toISOString() : null,
        related_report: prefillReportId ? Number(prefillReportId) : undefined,
      });
      setUserId('');
      setReason('');
      setEndsAt('');
      if (result?.pending_approval) {
        toast.success(result.message || 'Submitted — a second admin must approve before this suspension takes effect.');
      } else {
        toast.success('Suspension created');
      }
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create suspension');
    } finally {
      setCreating(false);
    }
  };

  const revokeSuspension = async (id: number) => {
    try {
      await suspensionsAPI.revoke(String(id), {
        revocation_reason: revokeReason[id] || '',
      });
      toast.success(`Suspension #${id} revoked`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to revoke suspension');
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Admin Suspensions</h1>
          <p className="text-muted-foreground mt-2">Issue and revoke account suspensions.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total</p><p className="text-xl font-semibold">{stats?.total ?? '-'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Active Now</p><p className="text-xl font-semibold">{stats?.currently_active ?? '-'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Revoked</p><p className="text-xl font-semibold">{stats?.by_status?.revoked ?? '-'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Expired</p><p className="text-xl font-semibold">{stats?.by_status?.expired ?? '-'}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Issue New Suspension</CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            {prefillReportId && (
              <div className="sm:col-span-2">
                <Badge variant="outline">Linked to report #{prefillReportId}</Badge>
              </div>
            )}
            <div className="space-y-2">
              <Label>User</Label>
              <UserAutocomplete value={userId} onChange={setUserId} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="temporary">temporary</SelectItem>
                  <SelectItem value="indefinite">indefinite</SelectItem>
                  <SelectItem value="permanent">permanent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type === 'temporary' && (
              <div className="space-y-2">
                <Label>Ends At</Label>
                <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            )}
            <div className="sm:col-span-2 space-y-2">
              <Label>Reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Write a clear suspension reason" />
            </div>
            <div className="sm:col-span-2">
              <Button onClick={createSuspension} disabled={creating}>{creating ? 'Creating...' : 'Issue Suspension'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suspension Records</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="temporary">Temporary</SelectItem>
                  <SelectItem value="indefinite">Indefinite</SelectItem>
                  <SelectItem value="permanent">Permanent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : items.length === 0 ? (
              <p className="text-muted-foreground">No suspensions found.</p>
            ) : (
              <div className="space-y-4">
                {items.map(item => (
                  <div key={item.id} className="border rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">#{item.id}</Badge>
                      <Badge>{item.status}</Badge>
                      <Badge variant="outline">{item.suspension_type}</Badge>
                      <span className="text-sm text-muted-foreground">User: {item.username} (#{item.user})</span>
                      <span className="text-sm text-muted-foreground">Start: {new Date(item.started_at).toLocaleString()}</span>
                      {item.ends_at && <span className="text-sm text-muted-foreground">Ends: {new Date(item.ends_at).toLocaleString()}</span>}
                      {item.related_report_id && <Badge variant="outline">Report #{item.related_report_id}</Badge>}
                    </div>

                    <p className="text-sm">{item.reason}</p>

                    {item.status === 'active' && (
                      <div className="grid sm:grid-cols-[1fr,140px] gap-3">
                        <Input
                          value={revokeReason[item.id] || ''}
                          onChange={(e) => setRevokeReason(prev => ({ ...prev, [item.id]: e.target.value }))}
                          placeholder="Optional revocation reason"
                        />
                        <Button variant="destructive" onClick={() => revokeSuspension(item.id)}>
                          Revoke
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {count > 0 && (
              <div className="flex items-center justify-between gap-2 pt-2">
                <p className="text-sm text-muted-foreground">
                  {count} record{count === 1 ? '' : 's'} · showing {offset + 1}-{Math.min(offset + LIMIT, count)}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={loading || offset <= 0} onClick={() => loadData(Math.max(0, offset - LIMIT))}>
                    Previous
                  </Button>
                  <Button size="sm" variant="outline" disabled={loading || offset + LIMIT >= count} onClick={() => loadData(offset + LIMIT)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
