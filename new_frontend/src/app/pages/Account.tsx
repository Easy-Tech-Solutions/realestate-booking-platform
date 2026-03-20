import React from 'react';
import { User, Mail, Phone, Shield, CreditCard, Bell, Globe, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import { useApp } from '../../core/context';
import { getInitials } from '../../core/utils';

export function Account() {
  const { user } = useApp();

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20">
        <h1 className="text-3xl font-semibold mb-8">Account</h1>

        <div className="max-w-4xl space-y-8">
          {/* Profile Section */}
          <div className="border border-border rounded-xl p-6">
            <div className="flex items-start gap-6 mb-6">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.firstName}
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary text-white flex items-center justify-center text-2xl font-semibold">
                  {getInitials(user.firstName, user.lastName)}
                </div>
              )}
              <div className="flex-1">
                <h2 className="text-2xl font-semibold mb-1">
                  {user.firstName} {user.lastName}
                </h2>
                <p className="text-muted-foreground">{user.email}</p>
                <Button variant="outline" className="mt-4">Edit profile</Button>
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
                  <Input id="firstName" defaultValue={user.firstName} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" defaultValue={user.lastName} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" defaultValue={user.email} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input id="phone" placeholder="+1 (555) 000-0000" defaultValue={user.phone} />
              </div>
              <Button>Save changes</Button>
            </div>
          </div>

          {/* Security */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Login & security</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold">Password</p>
                  <p className="text-sm text-muted-foreground">
                    Last updated 3 months ago
                  </p>
                </div>
                <Button variant="outline">Update</Button>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold">Two-factor authentication</p>
                  <p className="text-sm text-muted-foreground">
                    Add an extra layer of security
                  </p>
                </div>
                <Switch />
              </div>
            </div>
          </div>

          {/* Notifications */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6">Notifications</h2>
            <div className="space-y-4">
              {[
                { label: 'Email notifications', description: 'Receive booking updates via email' },
                { label: 'SMS notifications', description: 'Get text messages for important updates' },
                { label: 'Marketing emails', description: 'Receive promotional offers and tips' },
              ].map((item, i) => (
                <div key={i}>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-semibold">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch defaultChecked={i < 2} />
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
                <Button variant="outline" size="sm">Edit</Button>
              </div>
              <Button variant="outline">
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