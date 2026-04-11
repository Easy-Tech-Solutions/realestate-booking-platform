import React, { useEffect, useState } from 'react';
import { reportsAPI } from '../../services/api.service';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';

interface AdminReport {
  id: number;
  reporter_username: string;
  content_type: string;
  report_type: string;
  description: string;
  status: 'pending' | 'under_review' | 'resolved' | 'dismissed';
  created_at: string;
}

const STATUS_OPTIONS = ['pending', 'under_review', 'resolved', 'dismissed'] as const;

export function AdminReports() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [draftStatus, setDraftStatus] = useState<Record<number, string>>({});
  const [draftNotes, setDraftNotes] = useState<Record<number, string>>({});

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

  const visibleReports = statusFilter === 'all'
    ? reports
    : reports.filter(r => r.status === statusFilter);

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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>All Reports</CardTitle>
            <div className="w-52">
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
                      <Badge variant="secondary">#{report.id}</Badge>
                      <Badge>{report.status}</Badge>
                      <Badge variant="outline">{report.content_type}</Badge>
                      <Badge variant="outline">{report.report_type}</Badge>
                      <span className="text-sm text-muted-foreground">Reporter: {report.reporter_username}</span>
                      <span className="text-sm text-muted-foreground">Created: {new Date(report.created_at).toLocaleString()}</span>
                    </div>

                    <p className="text-sm">{report.description}</p>

                    <div className="grid lg:grid-cols-[220px,1fr,120px] gap-3">
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
