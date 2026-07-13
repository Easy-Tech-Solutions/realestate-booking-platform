import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, ScrollText } from 'lucide-react';
import { toast } from 'sonner';
import { superadminAPI, type AuditLogEntry } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Badge } from '../components/ui/badge';

export function AdminAuditLog() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');

  const load = async (p = page) => {
    setLoading(true);
    try {
      const data = await superadminAPI.getAuditLog({
        page: p,
        action: actionFilter || undefined,
        target_type: targetTypeFilter || undefined,
      });
      setEntries(data.results);
      setCount(data.count);
      setPageSize(data.page_size);
      setPage(data.page);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><ScrollText className="h-5 w-5" /> Audit Log</h1>
      </div>

      <Card>
        <CardHeader><CardTitle>Filters</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Action contains</label>
            <Input value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="e.g. impersonation" className="w-56" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Target type</label>
            <Input value={targetTypeFilter} onChange={(e) => setTargetTypeFilter(e.target.value)} placeholder="e.g. user" className="w-40" />
          </div>
          <Button size="sm" onClick={() => load(1)}>Apply</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit log entries match these filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(e.created_at).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">{e.actor_username || '(deleted user)'}</TableCell>
                      <TableCell><Badge variant="secondary">{e.action}</Badge></TableCell>
                      <TableCell className="text-sm">{e.target_type}{e.target_repr ? `: ${e.target_repr}` : ''}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm" title={e.reason}>{e.reason || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{e.ip_address || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="flex items-center justify-between mt-4">
            <span className="text-sm text-muted-foreground">Page {page} of {totalPages} ({count} total)</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => load(page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => load(page + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
