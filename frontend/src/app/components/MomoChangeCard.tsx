import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { useApp } from '../../hooks/useApp';
import { usersAPI } from '../../services/api/users';
import { hostApplicationsAPI } from '../../services/api/hostApplications';
import { getErrorMessage } from '../../services/api/shared/errors';

/**
 * Host-dashboard card to change the payout Mobile Money number via the same
 * 2-step (email + SMS OTP) flow as the contact-phone change. The number is
 * written server-side to the host's approved application (the canonical payout
 * destination); the network is fixed to MTN and not shown here.
 */
export function MomoChangeCard() {
  const { user } = useApp();
  const hasPassword = user?.hasPassword !== false;

  const [currentMomo, setCurrentMomo] = useState('');
  const [newMomo, setNewMomo] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    hostApplicationsAPI
      .getMine()
      .then((app) => { if (active && app) setCurrentMomo(app.momo_number || ''); })
      .catch(() => { /* no application / not a host — leave blank */ });
    return () => { active = false; };
  }, []);

  const initiate = async () => {
    if (!newMomo.trim()) { toast.error('Enter your new Mobile Money number.'); return; }
    setLoading(true);
    try {
      const res = await usersAPI.initiateMomoChange({
        ...(hasPassword ? { password } : {}),
        new_momo_number: newMomo.trim(),
      });
      toast.success(res.message);
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Could not send the verification code.');
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!otp.trim()) { toast.error('Enter the verification code.'); return; }
    setLoading(true);
    try {
      const res = await usersAPI.verifyMomoChange(otp.trim());
      toast.success(res.message);
      setCurrentMomo(newMomo.trim());
      setNewMomo(''); setOtp(''); setPassword('');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Could not verify the code.');
    } finally {
      setLoading(false);
    }
  };

  const cancel = async () => {
    setLoading(true);
    try {
      const res = await usersAPI.cancelMomoChange();
      toast.success(res.message);
      setOtp('');
    } catch (err) {
      toast.error(getErrorMessage(err) || 'Could not cancel the pending change.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout Mobile Money number</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Current payout number</Label>
          <Input value={currentMomo || 'No number on file'} disabled className="bg-muted border-border text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            The MTN Mobile Money number we send your booking payouts to.
          </p>
        </div>

        <Separator />

        <p className="text-sm text-muted-foreground">
          {hasPassword
            ? '2-step security: confirm your password and new number → enter the 6-digit code we send to your email and new number.'
            : '2-step security: we send a 6-digit code to your email and new number → enter it to confirm.'}
        </p>

        <p className="text-sm font-medium text-muted-foreground">Step 1 — Request codes</p>
        <div className="grid sm:grid-cols-2 gap-4">
          {hasPassword && (
            <div className="space-y-1.5">
              <Label htmlFor="momo-pass">Current password</Label>
              <div className="relative">
                <Input
                  id="momo-pass"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-card border-border pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="momo-new">New Mobile Money number</Label>
            <Input
              id="momo-new"
              value={newMomo}
              onChange={(e) => setNewMomo(e.target.value)}
              placeholder="e.g. 0880123456"
              className="bg-card border-border"
            />
          </div>
        </div>
        <Button onClick={initiate} disabled={loading}>
          {loading ? 'Please wait…' : 'Send verification code'}
        </Button>

        <Separator />

        <p className="text-sm font-medium text-muted-foreground">Step 2 — Enter the code</p>
        <div className="space-y-1.5">
          <Label htmlFor="momo-otp">Verification code</Label>
          <Input
            id="momo-otp"
            placeholder="6-digit code sent to your email and new number"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="bg-card border-border"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="w-full sm:w-auto" onClick={verify} disabled={loading}>
            {loading ? 'Please wait…' : 'Confirm change'}
          </Button>
          <Button variant="destructive" className="w-full sm:w-auto" onClick={cancel} disabled={loading}>
            Cancel pending change
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
