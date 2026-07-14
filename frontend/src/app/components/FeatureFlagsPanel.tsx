import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { platformOpsAPI } from '../../services/api/platformops';
import type { FeatureFlag } from '../../services/api/platformops';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { getErrorMessage } from '../../services/api/shared/errors';

const WIRED_FLAG_KEYS = new Set(['maintenance_mode', 'new_registrations_enabled', 'ai_scoring_enabled']);

export function FeatureFlagsPanel() {
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
          A flag only does something if code actually checks it. Three are wired to real enforcement today:
          <code className="mx-1">maintenance_mode</code> (makes the API read-only for non-staff),
          <code className="mx-1">new_registrations_enabled</code> (blocks new signups when off), and
          <code className="mx-1">ai_scoring_enabled</code> (turns the local AI scoring tasks — KYC pre-screen,
          fraud, listing moderation — on or off; default off). Creating any other key just records the
          switch — it won't gate anything until a developer wires it up.
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
                    {WIRED_FLAG_KEYS.has(f.key) && (
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
