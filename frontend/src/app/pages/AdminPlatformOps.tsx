import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft, Cpu, RefreshCw, AlertTriangle, CheckCircle2, XCircle,
  HardDrive, MemoryStick, Network, FileText, Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { platformOpsAPI } from '../../services/api/platformops';
import type { SystemHealth, LogEntry, ServerMetrics } from '../../services/api/platformops';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { getErrorMessage } from '../../services/api/shared/errors';

// ── Helpers ────────────────────────────────────────────────────────────────

function StatusPill({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> OK</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm text-destructive"><XCircle className="h-4 w-4" /> Down</span>
  );
}

function GaugeBar({ value, max = 100, warn = 70, danger = 90 }: { value: number; max?: number; warn?: number; danger?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  const color = pct >= danger ? 'bg-destructive' : pct >= warn ? 'bg-yellow-500' : 'bg-primary';
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG:    'bg-slate-100 text-slate-600',
  INFO:     'bg-blue-100 text-blue-700',
  WARNING:  'bg-yellow-100 text-yellow-700',
  ERROR:    'bg-red-100 text-red-700',
  CRITICAL: 'bg-red-200 text-red-900',
};

// ── System Health ──────────────────────────────────────────────────────────

function SystemHealthPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setHealth(await platformOpsAPI.systemHealth()); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to load system health')); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>System health</CardTitle>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !health ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Database',       data: health.database },
                { label: 'Redis',          data: health.redis },
                { label: 'Celery workers', data: health.celery_workers, sub: health.celery_workers.worker_count !== undefined ? `${health.celery_workers.worker_count} online` : undefined },
                { label: 'Disk free',      data: health.disk, sub: health.disk.free_gb !== undefined ? `${health.disk.free_gb} GB free (${health.disk.used_percent}% used)` : undefined },
              ].map(({ label, data, sub }) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <StatusPill ok={data.ok} />
                  {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {health.recent_errors_last_hour > 0 ? (
                <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" /> {health.recent_errors_last_hour} error(s) in the last hour</Badge>
              ) : (
                <Badge variant="outline">No errors in the last hour</Badge>
              )}
            </div>

            {health.scheduled_tasks.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Scheduled tasks</p>
                <div className="space-y-1">
                  {health.scheduled_tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between text-sm border-b border-border/50 py-1.5">
                      <span className="font-mono text-xs">{t.task_name}</span>
                      <span className="flex items-center gap-2">
                        {t.last_success === false && <Badge variant="destructive">failed</Badge>}
                        <span className="text-xs text-muted-foreground">{t.last_run_at ? new Date(t.last_run_at).toLocaleString() : 'never'} · {t.run_count} runs</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Server Metrics ─────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, unit, gauge, sub }: {
  icon: React.ElementType; label: string; value: number; unit: string;
  gauge?: { value: number; warn?: number; danger?: number };
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4" />{label}
          </div>
          <span className="text-xl font-bold">{value}<span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span></span>
        </div>
        {gauge && <GaugeBar value={gauge.value} warn={gauge.warn} danger={gauge.danger} />}
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ServerMetricsPanel() {
  const [data, setData] = useState<ServerMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try { setData(await platformOpsAPI.serverMetrics()); }
    catch (err) { toast.error(getErrorMessage(err, 'Failed to load server metrics')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 30_000); // auto-refresh every 30s
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const live = data?.live;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Server resources</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Auto-refreshes every 30s</span>
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !live ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                icon={Cpu} label="CPU" value={live.cpu_percent} unit="%"
                gauge={{ value: live.cpu_percent, warn: 70, danger: 90 }}
              />
              <MetricCard
                icon={MemoryStick} label="Memory" value={live.memory_percent} unit="%"
                gauge={{ value: live.memory_percent, warn: 75, danger: 90 }}
                sub={`${live.memory_used_mb.toLocaleString()} / ${live.memory_total_mb.toLocaleString()} MB`}
              />
              <MetricCard
                icon={HardDrive} label="Disk used" value={live.disk_used_percent} unit="%"
                gauge={{ value: live.disk_used_percent, warn: 75, danger: 90 }}
                sub={`${live.disk_free_gb} GB free`}
              />
              <MetricCard
                icon={Network} label="Net sent" value={live.net_bytes_sent_mb} unit="MB"
                sub={`Recv: ${live.net_bytes_recv_mb} MB`}
              />
            </div>

            {data.history.length > 1 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">CPU history (last {data.history.length} snapshots, 5-min intervals)</p>
                <div className="flex items-end gap-px h-12 w-full">
                  {data.history.slice(-60).map((s, i) => {
                    const h = Math.max(2, (s.cpu_percent / 100) * 48);
                    const color = s.cpu_percent >= 90 ? 'bg-destructive' : s.cpu_percent >= 70 ? 'bg-yellow-500' : 'bg-primary/60';
                    return (
                      <div
                        key={i}
                        title={`${new Date(s.recorded_at).toLocaleTimeString()} — CPU ${s.cpu_percent}%`}
                        className={`flex-1 rounded-sm ${color}`}
                        style={{ height: `${h}px` }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{data.history.length > 0 ? new Date(data.history[0].recorded_at).toLocaleTimeString() : ''}</span>
                  <span>now</span>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Log Viewer ─────────────────────────────────────────────────────────────

type LogFile = 'errors' | 'application' | 'activity' | 'transactions';

function LogViewerPanel() {
  const [file, setFile] = useState<LogFile>('errors');
  const [level, setLevel] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (f: LogFile, lv: string, s: string) => {
    setLoading(true);
    try {
      setEntries(await platformOpsAPI.logViewer({ file: f, limit: 200, level: lv || undefined, search: s || undefined }));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load logs'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(file, level, search); }, [file, level, search, load]);

  const LOG_FILES: { key: LogFile; label: string }[] = [
    { key: 'errors',       label: 'Errors' },
    { key: 'application',  label: 'Application' },
    { key: 'activity',     label: 'Activity' },
    { key: 'transactions', label: 'Transactions' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Log Viewer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Controls */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* File tabs */}
          <div className="flex gap-1">
            {LOG_FILES.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFile(key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  file === key ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Level filter */}
          <Select value={level || '_all'} onValueChange={(v) => setLevel(v === '_all' ? '' : v)}>
            <SelectTrigger className="w-32 h-8 text-xs">
              <SelectValue placeholder="All levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">All levels</SelectItem>
              {['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-xs"
              placeholder="Search messages…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setSearch(searchInput)}
            />
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSearch(searchInput)}>Search</Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => load(file, level, search)}>
            <RefreshCw className="h-3 w-3 mr-1" /> Refresh
          </Button>
        </div>

        {/* Log entries */}
        {loading ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No log entries found.</p>
        ) : (
          <div className="space-y-1 max-h-[520px] overflow-y-auto font-mono text-xs">
            {entries.map((e, i) => (
              <div key={i} className="border-b border-border/40 pb-1.5 pt-1 flex flex-col gap-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {e.ts && <span className="text-muted-foreground shrink-0">{e.ts}</span>}
                  {e.level && (
                    <Badge className={`text-[10px] px-1.5 py-0 ${LEVEL_COLORS[e.level] ?? 'bg-gray-100 text-gray-600'}`}>
                      {e.level}
                    </Badge>
                  )}
                  {e.logger && <span className="text-muted-foreground">{e.logger}</span>}
                </div>
                <span className="break-all">{e.msg ?? e.raw}</span>
                {e.exception && (
                  <pre className="text-destructive text-[10px] whitespace-pre-wrap mt-0.5">{String(e.exception)}</pre>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Showing up to 200 most recent entries (newest first).</p>
      </CardContent>
    </Card>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function AdminPlatformOps() {
  const navigate = useNavigate();
  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Cpu className="h-5 w-5" /> Platform & Engineering</h1>
      </div>
      <p className="text-sm text-muted-foreground -mt-4">
        Feature flags moved to Settings — this page is diagnostics, server monitoring, and log access.
      </p>

      <SystemHealthPanel />
      <ServerMetricsPanel />
      <LogViewerPanel />
    </div>
  );
}
