import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { reportsAPI } from '../../services/api.service';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Checkbox } from '../components/ui/checkbox';
import { BulkActionBar } from '../components/BulkActionBar';
import { toast } from 'sonner';
import { getErrorMessage } from '../../services/api/shared/errors';

interface AdminReport {
  id: number;
  reporter_username: string;
  content_type: string;
  reported_user?: number | null;
  reported_user_name?: string | null;
  report_type: string;
  description: string;
  owner_name?: string;
  screenshot_url?: string | null;
  status: 'pending' | 'under_review' | 'resolved' | 'dismissed';
  escalated_at?: string | null;
  escalated_by_username?: string | null;
  escalation_notes?: string;
  created_at: string;
}

const STATUS_OPTIONS = ['pending', 'under_review', 'resolved', 'dismissed'] as const;

export function AdminReports() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [draftStatus, setDraftStatus] = useState<Record<number, string>>({});
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        reportsAPI.adminStats(),
        reportsAPI.listAdmin(),
      ]);
      setStats(statsRes);
      setReports(listRes.results || []);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const updateStatus = async (report: AdminReport) => {
    const nextStatus = draftStatus[report.id];
    if (!nextStatus) {
      toast.error('Select a new status first');
      return;
    }

    try {
      await reportsAPI.adminUpdateStatus(String(report.id), {
        status: nextStatus,
        admin_notes: draftNotes[report.id] || '',
      });
      toast.success(`Report #${report.id} updated`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update report');
    }
  };

  const escalateReport = async (report: AdminReport) => {
    try {
      await reportsAPI.adminEscalate(String(report.id), draftNotes[report.id] || '');
      toast.success(`Report #${report.id} escalated`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to escalate report');
    }
  };

  const visibleReports = statusFilter === 'all'
    ? reports
    : reports.filter(r => r.status === statusFilter);

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === visibleReports.length ? new Set() : new Set(visibleReports.map((r) => r.id))));
  };

  const bulkUpdateStatus = async (status: 'resolved' | 'dismissed' | 'under_review') => {
    setBulkBusy(true);
    try {
      const result = await reportsAPI.adminBulkAction({ report_ids: [...selected], status });
      toast.success(`${result.succeeded.length} succeeded, ${result.failed.length} failed.`);
      setSelected(new Set());
      loadData();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Bulk action failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Admin Reports</h1>
          <p className="text-muted-foreground mt-2">Review and resolve user-submitted reports.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total</p><p className="text-xl font-semibold">{stats?.total ?? '-'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Pending</p><p className="text-xl font-semibold">{stats?.pending ?? '-'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Under Review</p><p className="text-xl font-semibold">{stats?.under_review ?? '-'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Resolved</p><p className="text-xl font-semibold">{stats?.resolved ?? '-'}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Dismissed</p><p className="text-xl font-semibold">{stats?.dismissed ?? '-'}</p></CardContent></Card>
        </div>

        <BulkActionBar selectedCount={selected.size} onClear={() => setSelected(new Set())}>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkUpdateStatus('under_review')}>Mark under review</Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkUpdateStatus('resolved')}>Resolve</Button>
          <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={() => bulkUpdateStatus('dismissed')}>Dismiss</Button>
        </BulkActionBar>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={visibleReports.length > 0 && selected.size === visibleReports.length}
                onCheckedChange={toggleAll}
              />
              <CardTitle>All Reports</CardTitle>
            </div>
            <div className="w-full sm:w-52">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUS_OPTIONS.map(opt => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : visibleReports.length === 0 ? (
              <p className="text-muted-foreground">No reports found.</p>
            ) : (
              <div className="space-y-4">
                {visibleReports.map(report => (
                  <div key={report.id} className="border rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Checkbox checked={selected.has(report.id)} onCheckedChange={() => toggleOne(report.id)} />
                      <Badge variant="secondary">#{report.id}</Badge>
                      <Badge>{report.status}</Badge>
                      <Badge variant="outline">{report.content_type}</Badge>
                      <Badge variant="outline">{report.report_type}</Badge>
                      {report.escalated_at && <Badge variant="destructive">Escalated</Badge>}
                      <span className="text-sm text-muted-foreground">Reporter: {report.reporter_username}</span>
                      <span className="text-sm text-muted-foreground">Created: {new Date(report.created_at).toLocaleString()}</span>
                    </div>

                    {report.reported_user_name && (
                      <p className="text-sm text-muted-foreground">Reported user: {report.reported_user_name}</p>
                    )}
                    {report.escalated_at && (
                      <p className="text-xs text-destructive">
                        Escalated by {report.escalated_by_username} — {report.escalation_notes}
                      </p>
                    )}

                    <p className="text-sm">{report.description}</p>

                    {(report.owner_name || report.screenshot_url) && (
                      <div className="flex flex-wrap items-start gap-4 p-3 rounded-lg bg-muted/50 border">
                        {report.owner_name && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-0.5">Owner name</p>
                            <p className="text-sm">{report.owner_name}</p>
                          </div>
                        )}
                        {report.screenshot_url && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-1">Screenshot</p>
                            <a href={report.screenshot_url} target="_blank" rel="noopener noreferrer">
                              <img
                                src={report.screenshot_url}
                                alt="Report screenshot"
                                className="h-24 rounded border object-contain hover:opacity-80 transition-opacity"
                              />
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="grid sm:grid-cols-[1fr,120px] lg:grid-cols-[220px,1fr,120px] gap-3">
                      <Select
                        value={draftStatus[report.id] || ''}
                        onValueChange={(val) => setDraftStatus(prev => ({ ...prev, [report.id]: val }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Set status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="under_review">under_review</SelectItem>
                          <SelectItem value="resolved">resolved</SelectItem>
                          <SelectItem value="dismissed">dismissed</SelectItem>
                        </SelectContent>
                      </Select>

                      <Textarea
                        placeholder="Admin notes (optional)"
                        value={draftNotes[report.id] || ''}
                        onChange={(e) => setDraftNotes(prev => ({ ...prev, [report.id]: e.target.value }))}
                      />

                      <Button onClick={() => updateStatus(report)}>Update</Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => escalateReport(report)}>
                        Escalate
                      </Button>
                      {report.reported_user && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          onClick={() => navigate(`/management/suspensions?user=${report.reported_user}&report=${report.id}`)}
                        >
                          Suspend this user
                        </Button>
                      )}
                    </div>
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
