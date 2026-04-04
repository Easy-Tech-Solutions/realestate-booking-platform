import React, { useState } from 'react';
import { CreditCard, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import { useApp } from '../../core/context';
import { getInitials } from '../../core/utils';
import { toast } from 'sonner';

export function Account() {
  const { user, setUser } = useApp();

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [saving, setSaving] = useState(false);

  const [emailNotif, setEmailNotif] = useState(true);
  const [smsNotif, setSmsNotif] = useState(true);
  const [marketingNotif, setMarketingNotif] = useState(false);

  if (!user) return null;

  const handleSave = async () => {
    if (!firstName.trim() || !email.trim()) {
      toast.error('First name and email are required');
      return;
    }
    setSaving(true);
    await new Promise(r => setTimeout(r, 600));
    setUser({ ...user, firstName, lastName, email, phone });
    setSaving(false);
    toast.success('Profile updated successfully');
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
                <Input id="phone" placeholder="+1 (555) 000-0000" value={phone} onChange={e => setPhone(e.target.value)} />
              </div>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save changes'}
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
