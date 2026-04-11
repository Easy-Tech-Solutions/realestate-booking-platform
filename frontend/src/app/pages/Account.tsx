import React, { useEffect, useState } from 'react';
import { CreditCard, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import { useApp } from '../../hooks/useApp';
import { getInitials } from '../../core/utils';
import { toast } from 'sonner';
import { notificationsAPI, usersAPI } from '../../services/api.service';

export function Account() {
  const { user, setUser } = useApp();

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);

  const [emailNotif, setEmailNotif] = useState(true);
  const [smsNotif, setSmsNotif] = useState(true);
  const [marketingNotif, setMarketingNotif] = useState(true);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [networkProvider, setNetworkProvider] = useState<'mtn' | 'orange'>('mtn');
  const [emailOtp, setEmailOtp] = useState('');
  const [smsOtp, setSmsOtp] = useState('');
  const [phoneFlowLoading, setPhoneFlowLoading] = useState(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    const loadPreferences = async () => {
      try {
        const prefs = await notificationsAPI.getPreferences();
        setEmailNotif(Boolean(prefs.in_app_enabled));
        setSmsNotif(Boolean(prefs.new_message_email));
        setMarketingNotif(Boolean(prefs.search_alert_email));
      } catch {
        // Keep current defaults if preference endpoint fails.
      }
    };

    loadPreferences();
  }, [user]);

  if (!user) return null;

  const handleSave = async () => {
    if (!firstName.trim() || !email.trim()) {
      toast.error('First name and email are required');
      return;
    }

    setSaving(true);
    try {
      await usersAPI.updateMyProfile({
        first_name: firstName,
        last_name: lastName,
        email,
      });

      await notificationsAPI.updatePreferences({
        in_app_enabled: emailNotif,
        new_message_email: smsNotif,
        search_alert_email: marketingNotif,
      });

      setUser({ ...user, firstName, lastName, email, phone });
      toast.success('Profile updated successfully');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleInitiatePhoneChange = async () => {
    if (!currentPassword || !newPhoneNumber) {
      toast.error('Current password and new phone number are required');
      return;
    }

    setPhoneFlowLoading(true);
    try {
      const res = await usersAPI.initiatePhoneChange({
        password: currentPassword,
        new_phone_number: newPhoneNumber,
        network_provider: networkProvider,
      });
      toast.success(res.message || 'Email verification code sent');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to start phone change');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  const handleVerifyEmailOtp = async () => {
    if (!emailOtp) {
      toast.error('Enter the email OTP first');
      return;
    }
    setPhoneFlowLoading(true);
    try {
      const res = await usersAPI.verifyPhoneChangeEmail(emailOtp);
      toast.success(res.message || 'Email OTP verified');
    } catch (error: any) {
      toast.error(error?.message || 'Email OTP verification failed');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  const handleVerifySmsOtp = async () => {
    if (!smsOtp) {
      toast.error('Enter the SMS OTP first');
      return;
    }
    setPhoneFlowLoading(true);
    try {
      const res = await usersAPI.verifyPhoneChangeSms(smsOtp);
      setPhone(newPhoneNumber);
      setCurrentPassword('');
      setEmailOtp('');
      setSmsOtp('');
      setNewPhoneNumber('');
      toast.success(res.message || 'Phone number updated');
    } catch (error: any) {
      toast.error(error?.message || 'SMS OTP verification failed');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  const handleCancelPhoneChange = async () => {
    setPhoneFlowLoading(true);
    try {
      const res = await usersAPI.cancelPhoneChange();
      setEmailOtp('');
      setSmsOtp('');
      toast.success(res.message || 'Phone change canceled');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel phone change');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <h1 className="text-3xl font-semibold mb-8">Account</h1>

        <div className="max-w-4xl space-y-8">
          {/* Profile Section */}
          <div className="border border-border rounded-xl p-6">
            <div className="flex items-start gap-6 mb-6">
              {user.avatar ? (
                <img src={user.avatar} alt={user.firstName} className="w-20 h-20 rounded-full object-cover" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary text-white flex items-center justify-center text-2xl font-semibold">
                  {getInitials(user.firstName, user.lastName)}
                </div>
              )}
              <div className="flex-1">
                <h2 className="text-2xl font-semibold mb-1">{user.firstName} {user.lastName}</h2>
                <p className="text-muted-foreground">{user.email}</p>
              </div>
            </div>
          </div>

          {/* Personal Info */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Personal information</h2>
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" placeholder="Managed by secure flow below" value={phone} onChange={e => setPhone(e.target.value)} disabled />
              </div>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
              </Button>
            </div>
          </div>

          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Change Mobile Money Number</h2>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This follows the backend 3-step security flow: password verification, email OTP, then SMS OTP.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input id="currentPassword" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="newPhone">New phone number</Label>
                  <Input id="newPhone" value={newPhoneNumber} onChange={e => setNewPhoneNumber(e.target.value)} placeholder="e.g. 0880123456" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="network">Network provider</Label>
                <select
                  id="network"
                  className="w-full rounded-md border border-border bg-background px-3 py-2"
                  value={networkProvider}
                  onChange={e => setNetworkProvider(e.target.value as 'mtn' | 'orange')}
                >
                  <option value="mtn">MTN</option>
                  <option value="orange">Orange</option>
                </select>
              </div>
              <Button onClick={handleInitiatePhoneChange} disabled={phoneFlowLoading}>
                {phoneFlowLoading ? 'Please wait...' : '1. Send Email OTP'}
              </Button>

              <Separator />

              <div className="grid sm:grid-cols-[1fr,auto] gap-3">
                <Input placeholder="2. Enter Email OTP" value={emailOtp} onChange={e => setEmailOtp(e.target.value)} />
                <Button variant="outline" onClick={handleVerifyEmailOtp} disabled={phoneFlowLoading}>Verify Email OTP</Button>
              </div>

              <div className="grid sm:grid-cols-[1fr,auto] gap-3">
                <Input placeholder="3. Enter SMS OTP" value={smsOtp} onChange={e => setSmsOtp(e.target.value)} />
                <Button variant="outline" onClick={handleVerifySmsOtp} disabled={phoneFlowLoading}>Verify SMS OTP</Button>
              </div>

              <Button variant="destructive" onClick={handleCancelPhoneChange} disabled={phoneFlowLoading}>
                Cancel Pending Phone Change
              </Button>
            </div>
          </div>

          {/* Security */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Login & security</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold">Password</p>
                  <p className="text-sm text-muted-foreground">Last updated 3 months ago</p>
                </div>
                <Button variant="outline" onClick={() => toast.info('Password reset email sent')}>Update</Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold">Two-factor authentication</p>
                  <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
                </div>
                <Switch onCheckedChange={v => toast.success(v ? '2FA enabled' : '2FA disabled')} />
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Notifications</h2>
            <div className="space-y-4">
              {[
                { label: 'Email notifications', description: 'Receive booking updates via email', value: emailNotif, setter: setEmailNotif },
                { label: 'SMS notifications', description: 'Get text messages for important updates', value: smsNotif, setter: setSmsNotif },
                { label: 'Marketing emails', description: 'Receive promotional offers and tips', value: marketingNotif, setter: setMarketingNotif },
              ].map((item, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-semibold">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch
                      checked={item.value}
                      onCheckedChange={v => { item.setter(v); toast.success(`${item.label} ${v ? 'enabled' : 'disabled'}`); }}
                    />
                  </div>
                  {i < 2 && <Separator />}
                </div>
              ))}
            </div>
          </div>

          {/* Payments */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Payment methods</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-border rounded-lg">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5" />
                  <div>
                    <p className="font-semibold">•••• •••• •••• 4242</p>
                    <p className="text-sm text-muted-foreground">Expires 12/26</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => toast.info('Card editing coming soon')}>Edit</Button>
              </div>
              <Button variant="outline" onClick={() => toast.info('Add payment method coming soon')}>
                <Plus className="w-4 h-4 mr-2" />
                Add payment method
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
