import React, { useEffect, useState } from 'react';
import { suspensionsAPI } from '../../services/api.service';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
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
}

export function AdminSuspensions() {
  const [stats, setStats] = useState<any>(null);
  const [items, setItems] = useState<SuspensionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [userId, setUserId] = useState('');
  const [type, setType] = useState<'temporary' | 'indefinite' | 'permanent'>('temporary');
  const [reason, setReason] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [revokeReason, setRevokeReason] = useState<Record<number, string>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        suspensionsAPI.stats(),
        suspensionsAPI.list(),
      ]);
      setStats(statsRes);
      setItems(listRes.results || []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load suspensions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
      await suspensionsAPI.create({
        user: Number(userId),
        suspension_type: type,
        reason,
        ends_at: type === 'temporary' ? new Date(endsAt).toISOString() : null,
      });
      setUserId('');
      setReason('');
      setEndsAt('');
      toast.success('Suspension created');
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
          <CardContent className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>User ID</Label>
              <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="e.g. 12" />
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
            <div className="md:col-span-2 space-y-2">
              <Label>Reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Write a clear suspension reason" />
            </div>
            <div className="md:col-span-2">
              <Button onClick={createSuspension} disabled={creating}>{creating ? 'Creating...' : 'Issue Suspension'}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Suspension Records</CardTitle>
          </CardHeader>
          <CardContent>
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
                    </div>

                    <p className="text-sm">{item.reason}</p>

                    {item.status === 'active' && (
                      <div className="grid md:grid-cols-[1fr,140px] gap-3">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
