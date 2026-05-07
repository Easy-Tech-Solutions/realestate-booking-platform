import React, { useEffect, useRef, useState } from 'react';
import { Camera, CreditCard, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import { useApp } from '../../hooks/useApp';
import { getInitials } from '../../core/utils';
import { toast } from 'sonner';
import { notificationsAPI, usersAPI } from '../../services/api.service';
import { normalizeUser } from '../../services/api/shared/normalizers';

export function Account() {
  const { user, setUser } = useApp();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    if (!user) return;
    setFirstName(user.firstName ?? '');
    setLastName(user.lastName ?? '');
    setEmail(user.email ?? '');
    setBio(user.bio ?? '');
    setPhone(user.phone ?? '');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    notificationsAPI.getPreferences().then(prefs => {
      setEmailNotif(Boolean(prefs.in_app_enabled));
      setSmsNotif(Boolean(prefs.new_message_email));
      setMarketingNotif(Boolean(prefs.search_alert_email));
    }).catch(() => {});
  }, [user]);

  if (!user) return null;

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be smaller than 5MB');
      return;
    }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    // Reset input so the same file can be re-selected if needed
    e.target.value = '';
  };

  const handleSave = async () => {
    if (!firstName.trim() || !email.trim()) {
      toast.error('First name and email are required');
      return;
    }

    setSaving(true);
    try {
      const updated = await usersAPI.updateMyProfile({
        first_name: firstName,
        last_name: lastName,
        email,
        bio,
        ...(avatarFile ? { image: avatarFile } : {}),
      });

      await notificationsAPI.updatePreferences({
        in_app_enabled: emailNotif,
        new_message_email: smsNotif,
        search_alert_email: marketingNotif,
      });

      const freshUser = normalizeUser(updated);
      setUser(freshUser);
      setAvatarFile(null);
      if (avatarPreview) {
        URL.revokeObjectURL(avatarPreview);
        setAvatarPreview(null);
      }
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
    if (!emailOtp) { toast.error('Enter the email OTP first'); return; }
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
    if (!smsOtp) { toast.error('Enter the SMS OTP first'); return; }
    setPhoneFlowLoading(true);
    try {
      const res = await usersAPI.verifyPhoneChangeSms(smsOtp);
      setPhone(newPhoneNumber);
      setCurrentPassword(''); setEmailOtp(''); setSmsOtp(''); setNewPhoneNumber('');
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
      setEmailOtp(''); setSmsOtp('');
      toast.success(res.message || 'Phone change canceled');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel phone change');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  const currentAvatar = avatarPreview ?? user.avatar;

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <h1 className="text-3xl font-semibold mb-8">Account</h1>

        <div className="max-w-4xl space-y-8">

          {/* Profile */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Profile</h2>
            <div className="flex flex-col sm:flex-row items-start gap-8">

              {/* Avatar upload */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  className="relative w-24 h-24 rounded-full group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Change profile photo"
                >
                  {currentAvatar ? (
                    <img
                      src={currentAvatar}
                      alt={user.firstName}
                      className="w-24 h-24 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-semibold select-none">
                      {getInitials(user.firstName, user.lastName)}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </button>
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  {avatarFile ? avatarFile.name.slice(0, 20) + (avatarFile.name.length > 20 ? '…' : '') : 'Upload photo'}
                </button>
                {avatarFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarFile(null);
                      if (avatarPreview) { URL.revokeObjectURL(avatarPreview); setAvatarPreview(null); }
                    }}
                    className="text-xs text-destructive underline underline-offset-2 hover:no-underline"
                  >
                    Remove
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  title="Upload profile photo"
                  aria-label="Upload profile photo"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* Fields */}
              <div className="flex-1 space-y-4 w-full">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">First name</Label>
                    <Input
                      id="firstName"
                      value={firstName}
                      onChange={e => setFirstName(e.target.value)}
                      className="bg-card border-border"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input
                      id="lastName"
                      value={lastName}
                      onChange={e => setLastName(e.target.value)}
                      className="bg-card border-border"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="bg-card border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="bio">Bio</Label>
                  <textarea
                    id="bio"
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    rows={3}
                    placeholder="Tell guests a little about yourself…"
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring transition-[box-shadow]"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Mobile Money number</Label>
                  <Input
                    value={phone || 'No number added yet'}
                    disabled
                    className="bg-muted border-border text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">Use the section below to add or change your MoMo number.</p>
                </div>

                <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>

          {/* Change MoMo Number */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-2">Change Mobile Money Number</h2>
            <p className="text-sm text-muted-foreground mb-6">
              This uses a 3-step security flow: password verification → email OTP → SMS OTP on the new number.
            </p>
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    className="bg-card border-border"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newPhone">New MoMo number</Label>
                  <Input
                    id="newPhone"
                    value={newPhoneNumber}
                    onChange={e => setNewPhoneNumber(e.target.value)}
                    placeholder="e.g. 0880123456"
                    className="bg-card border-border"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="network">Network provider</Label>
                <select
                  id="network"
                  title="Network provider"
                  className="w-full rounded-md border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring transition-[box-shadow]"
                  value={networkProvider}
                  onChange={e => setNetworkProvider(e.target.value as 'mtn' | 'orange')}
                >
                  <option value="mtn">MTN Mobile Money</option>
                  <option value="orange">Orange Money</option>
                </select>
              </div>

              <Button onClick={handleInitiatePhoneChange} disabled={phoneFlowLoading}>
                {phoneFlowLoading ? 'Please wait…' : 'Step 1 — Send Email OTP'}
              </Button>

              <Separator />

              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Step 2 — Verify email code</p>
                <div className="flex gap-3">
                  <Input
                    placeholder="6-digit email OTP"
                    value={emailOtp}
                    onChange={e => setEmailOtp(e.target.value)}
                    className="bg-card border-border"
                  />
                  <Button variant="outline" onClick={handleVerifyEmailOtp} disabled={phoneFlowLoading} className="shrink-0">
                    Verify
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Step 3 — Verify SMS code</p>
                <div className="flex gap-3">
                  <Input
                    placeholder="6-digit SMS OTP"
                    value={smsOtp}
                    onChange={e => setSmsOtp(e.target.value)}
                    className="bg-card border-border"
                  />
                  <Button variant="outline" onClick={handleVerifySmsOtp} disabled={phoneFlowLoading} className="shrink-0">
                    Verify
                  </Button>
                </div>
              </div>

              <Button variant="destructive" size="sm" onClick={handleCancelPhoneChange} disabled={phoneFlowLoading}>
                Cancel pending change
              </Button>
            </div>
          </div>

          {/* Security */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Login &amp; security</h2>
            <div className="space-y-1">
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">Password</p>
                  <p className="text-sm text-muted-foreground">Update your account password</p>
                </div>
                <Button variant="outline" onClick={() => toast.info('Password reset email sent')}>Update</Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">Two-factor authentication</p>
                  <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
                </div>
                <Switch onCheckedChange={v => toast.success(v ? '2FA enabled' : '2FA disabled')} />
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Notifications</h2>
            <div className="space-y-1">
              {[
                { label: 'In-app notifications', description: 'Receive booking updates in the app', value: emailNotif, setter: setEmailNotif },
                { label: 'Message emails', description: 'Get emails when you receive new messages', value: smsNotif, setter: setSmsNotif },
                { label: 'Marketing emails', description: 'Receive promotional offers and tips', value: marketingNotif, setter: setMarketingNotif },
              ].map((item, i, arr) => (
                <div key={i}>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch
                      checked={item.value}
                      onCheckedChange={v => {
                        item.setter(v);
                        toast.success(`${item.label} ${v ? 'enabled' : 'disabled'}`);
                      }}
                    />
                  </div>
                  {i < arr.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </div>

          {/* Payments */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Payment methods</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 border border-border rounded-lg bg-muted/30">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">•••• •••• •••• 4242</p>
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
