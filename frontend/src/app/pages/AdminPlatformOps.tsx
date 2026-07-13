import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Cpu, RefreshCw, Trash2, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { platformOpsAPI } from '../../services/api/platformops';
import type { FeatureFlag, SystemHealth, LogEntry } from '../../services/api/platformops';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Switch } from '../components/ui/switch';
import { getErrorMessage } from '../../services/api/shared/errors';

function StatusPill({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-sm text-primary"><CheckCircle2 className="h-4 w-4" /> OK</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-sm text-destructive"><XCircle className="h-4 w-4" /> Down</span>
  );
}

function FeatureFlagsPanel() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setFlags(await platformOpsAPI.listFeatureFlags());
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load feature flags'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!key.trim() || !name.trim()) {
      toast.error('Key and name are required.');
      return;
    }
    setBusy(true);
    try {
      await platformOpsAPI.createFeatureFlag({ key: key.trim(), name: name.trim(), description: description.trim() });
      setKey(''); setName(''); setDescription('');
      toast.success('Feature flag created.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create flag'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (flag: FeatureFlag) => {
    try {
      await platformOpsAPI.updateFeatureFlag(flag.id, { is_enabled: !flag.is_enabled });
      toast.success(`${flag.name} ${!flag.is_enabled ? 'enabled' : 'disabled'}.`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update flag'));
    }
  };

  const remove = async (flag: FeatureFlag) => {
    try {
      await platformOpsAPI.deleteFeatureFlag(flag.id);
      toast.success('Flag deleted.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete flag'));
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Feature flags</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          A flag only does something if code actually checks it. Two are wired to real enforcement today:
          <code className="mx-1">maintenance_mode</code> (makes the API read-only for non-staff) and
          <code className="mx-1">new_registrations_enabled</code> (blocks new signups when off). Creating any
          other key just records the switch — it won't gate anything until a developer wires it up.
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <Input placeholder="key (e.g. maintenance_mode)" value={key} onChange={(e) => setKey(e.target.value)} />
          <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <Button size="sm" disabled={busy} onClick={create}>Create flag</Button>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No feature flags yet.</p>
        ) : (
          <div className="space-y-2">
            {flags.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <p className="font-medium text-sm flex items-center gap-2">
                    {f.name} <code className="text-xs text-muted-foreground">{f.key}</code>
                    {(f.key === 'maintenance_mode' || f.key === 'new_registrations_enabled') && (
                      <Badge variant="outline" className="text-xs">wired</Badge>
                    )}
                  </p>
                  {f.description && <p className="text-xs text-muted-foreground">{f.description}</p>}
                  <p className="text-xs text-muted-foreground">Last changed by {f.updated_by_username || '—'} · {new Date(f.updated_at).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={f.is_enabled} onCheckedChange={() => toggle(f)} />
                  <Button size="icon" variant="ghost" onClick={() => remove(f)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SystemHealthPanel() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setHealth(await platformOpsAPI.systemHealth());
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load system health'));
    } finally {
      setLoading(false);
    }
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
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Database</p>
                <StatusPill ok={health.database.ok} />
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Redis</p>
                <StatusPill ok={health.redis.ok} />
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Celery workers</p>
                <StatusPill ok={health.celery_workers.ok} />
                {health.celery_workers.worker_count !== undefined && (
                  <p className="text-xs text-muted-foreground mt-1">{health.celery_workers.worker_count} online</p>
                )}
              </div>
              <div className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">Disk free</p>
                <StatusPill ok={health.disk.ok} />
                {health.disk.free_gb !== undefined && (
                  <p className="text-xs text-muted-foreground mt-1">{health.disk.free_gb} GB free ({health.disk.used_percent}% used)</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {health.recent_errors_last_hour > 0 ? (
                <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" /> {health.recent_errors_last_hour} error(s) in the last hour</Badge>
              ) : (
                <Badge variant="outline">No errors in the last hour</Badge>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Scheduled tasks</p>
              {health.scheduled_tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No task has run since deploy yet.</p>
              ) : (
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
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecentErrorsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setEntries(await platformOpsAPI.recentErrors(100));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load recent errors'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent errors</CardTitle>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent error log entries.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto font-mono text-xs">
            {entries.map((e, i) => (
              <div key={i} className="border-b border-border/50 pb-1.5">
                <span className="text-muted-foreground">{e.ts || ''}</span>{' '}
                <Badge variant={e.level === 'ERROR' || e.level === 'CRITICAL' ? 'destructive' : 'outline'} className="text-[10px]">{e.level || '—'}</Badge>{' '}
                <span>{e.logger}: {e.msg || e.raw}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

      <SystemHealthPanel />
      <FeatureFlagsPanel />
      <RecentErrorsPanel />
    </div>
  );
}
