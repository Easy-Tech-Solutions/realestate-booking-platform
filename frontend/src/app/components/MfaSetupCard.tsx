import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { superadminAPI, type MfaSetupResponse } from '../../services/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { KeyRound } from 'lucide-react';

export function MfaSetupCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setupData, setSetupData] = useState<MfaSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadStatus = () => {
    superadminAPI.getMe().then((me) => setEnabled(me.mfa_enabled)).catch(() => setEnabled(false));
  };

  useEffect(() => { loadStatus(); }, []);

  const handleSetup = async () => {
    setBusy(true);
    try {
      const data = await superadminAPI.mfaSetup();
      setSetupData(data);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to start MFA setup');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (code.trim().length < 6) return;
    setBusy(true);
    try {
      const { backup_codes } = await superadminAPI.mfaConfirm(code.trim());
      setBackupCodes(backup_codes);
      setSetupData(null);
      setCode('');
      setEnabled(true);
      toast.success('MFA enabled.');
    } catch (err: any) {
      toast.error(err?.message || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (disableCode.trim().length < 6) return;
    setBusy(true);
    try {
      await superadminAPI.mfaDisable(disableCode.trim());
      toast.success('MFA disabled.');
      setEnabled(false);
      setShowDisable(false);
      setDisableCode('');
    } catch (err: any) {
      toast.error(err?.message || 'Invalid code');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Two-Factor Authentication</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {backupCodes ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-destructive">
              Save these backup codes now — they're shown only once. Each can be used once if you lose access to your authenticator app.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-3 font-mono text-sm">
              {backupCodes.map((c) => <span key={c}>{c}</span>)}
            </div>
            <Button size="sm" onClick={() => setBackupCodes(null)}>I've saved these codes</Button>
          </div>
        ) : enabled === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : enabled ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">MFA is enabled on your account.</p>
            {showDisable ? (
              <div className="flex items-center gap-2">
                <Input placeholder="Enter code to confirm" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} className="max-w-[180px]" />
                <Button variant="destructive" size="sm" disabled={busy} onClick={handleDisable}>Confirm disable</Button>
                <Button variant="outline" size="sm" onClick={() => setShowDisable(false)}>Cancel</Button>
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowDisable(true)}>Disable MFA</Button>
            )}
          </div>
        ) : setupData ? (
          <div className="space-y-3">
            <img
              src={`data:image/png;base64,${setupData.qr_code_base64}`}
              alt="MFA QR code"
              className="h-40 w-40 rounded-lg border border-border"
            />
            <p className="text-xs text-muted-foreground">
              Scan with your authenticator app, or enter this key manually: <code className="font-mono">{setupData.secret}</code>
            </p>
            <div className="flex items-center gap-2">
              <Input placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-[140px]" />
              <Button size="sm" disabled={busy || code.trim().length < 6} onClick={handleConfirm}>Confirm</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Management accounts should enable two-factor authentication with an authenticator app.
            </p>
            <Button size="sm" disabled={busy} onClick={handleSetup}>Enable MFA</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
