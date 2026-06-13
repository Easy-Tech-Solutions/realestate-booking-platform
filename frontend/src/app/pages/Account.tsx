import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Camera, CreditCard, Eye, EyeOff, Plus, Star, Trash2, Pencil } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { useApp } from '../../hooks/useApp';
import { getInitials } from '../../core/utils';
import { toast } from 'sonner';
import { authAPI, cardsAPI, notificationsAPI, usersAPI } from '../../services/api.service';
import type { SavedCard } from '../../services/api.service';
import { normalizeUser } from '../../services/api/shared/normalizers';

// ── Card helpers ──────────────────────────────────────────────────────────────

function detectCardType(number: string): SavedCard['card_type'] {
  const n = number.replace(/\s/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^6(?:011|5)/.test(n)) return 'discover';
  return 'other';
}

function formatCardNumber(value: string) {
  return value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

const CARD_LOGOS: Record<SavedCard['card_type'], string> = {
  visa: 'VISA',
  mastercard: 'MC',
  amex: 'AMEX',
  discover: 'DISC',
  other: '••',
};

const CARD_COLORS: Record<SavedCard['card_type'], string> = {
  visa: 'bg-blue-600',
  mastercard: 'bg-red-600',
  amex: 'bg-green-700',
  discover: 'bg-orange-600',
  other: 'bg-zinc-600',
};

// ── Card form dialog ──────────────────────────────────────────────────────────

interface CardFormDialogProps {
  open: boolean;
  onClose: () => void;
  existing?: SavedCard;
  onSaved: (card: SavedCard) => void;
}

function CardFormDialog({ open, onClose, existing, onSaved }: CardFormDialogProps) {
  const isEdit = Boolean(existing);

  const [cardNumber, setCardNumber] = useState('');
  const [cardName, setCardName] = useState(existing?.cardholder_name ?? '');
  const [expiry, setExpiry] = useState(existing ? `${existing.expiry_month}/${existing.expiry_year.slice(2)}` : '');
  const [cvc, setCvc] = useState('');
  const [isDefault, setIsDefault] = useState(existing?.is_default ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCardNumber('');
      setCardName(existing?.cardholder_name ?? '');
      setExpiry(existing ? `${existing.expiry_month}/${existing.expiry_year.slice(2)}` : '');
      setCvc('');
      setIsDefault(existing?.is_default ?? false);
    }
  }, [open, existing]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = cardNumber.replace(/\s/g, '');
    const last4 = digits.slice(-4);
    const [mm, yy] = expiry.split('/');
    const month = mm?.padStart(2, '0');
    const year = yy ? `20${yy}` : '';

    if (!isEdit && (digits.length < 13 || digits.length > 19)) {
      toast.error('Enter a valid card number');
      return;
    }
    if (!cardName.trim()) {
      toast.error('Enter the cardholder name');
      return;
    }
    if (!month || !year || month.length !== 2 || year.length !== 4) {
      toast.error('Enter a valid expiry date (MM/YY)');
      return;
    }
    if (!isEdit && (!cvc || cvc.length < 3)) {
      toast.error('Enter a valid CVC');
      return;
    }

    setSaving(true);
    try {
      let card: SavedCard;
      if (isEdit && existing) {
        card = await cardsAPI.update(existing.id, {
          cardholder_name: cardName.trim(),
          expiry_month: month,
          expiry_year: year,
          is_default: isDefault,
        });
      } else {
        card = await cardsAPI.add({
          cardholder_name: cardName.trim(),
          last4,
          card_type: detectCardType(digits),
          expiry_month: month,
          expiry_year: year,
          is_default: isDefault,
        });
      }
      onSaved(card);
      toast.success(isEdit ? 'Card updated' : 'Card added');
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save card');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit card' : 'Add new card'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="cardNumber">Card number</Label>
              <Input
                id="cardNumber"
                inputMode="numeric"
                placeholder="1234 5678 9012 3456"
                value={cardNumber}
                onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                className="bg-card border-border font-mono tracking-widest"
                maxLength={19}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="cardName">Cardholder name</Label>
            <Input
              id="cardName"
              placeholder="John Doe"
              value={cardName}
              onChange={e => setCardName(e.target.value)}
              className="bg-card border-border"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="expiry">Expiry date</Label>
              <Input
                id="expiry"
                inputMode="numeric"
                placeholder="MM/YY"
                value={expiry}
                onChange={e => setExpiry(formatExpiry(e.target.value))}
                className="bg-card border-border font-mono"
                maxLength={5}
              />
            </div>
            {!isEdit && (
              <div className="space-y-1.5">
                <Label htmlFor="cvc">CVC</Label>
                <Input
                  id="cvc"
                  inputMode="numeric"
                  placeholder="123"
                  value={cvc}
                  onChange={e => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="bg-card border-border font-mono"
                  maxLength={4}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3 bg-muted/30">
            <Label htmlFor="isDefault" className="cursor-pointer font-normal">
              Set as default payment method
            </Label>
            <Switch
              id="isDefault"
              checked={isDefault}
              onCheckedChange={setIsDefault}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            {isEdit
              ? 'Only your card details are updated — no full card number is stored.'
              : 'Only the last 4 digits are stored. Your full card number and CVC are never saved.'}
          </p>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Update card' : 'Add card'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Card display tile ─────────────────────────────────────────────────────────

interface CardTileProps {
  card: SavedCard;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}

function CardTile({ card, onEdit, onDelete, onSetDefault }: CardTileProps) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return; }
    setLoading(true);
    try {
      await cardsAPI.remove(card.id);
      onDelete();
      toast.success('Card removed');
    } catch {
      toast.error('Failed to remove card');
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  };

  const handleSetDefault = async () => {
    setLoading(true);
    try {
      await cardsAPI.setDefault(card.id);
      onSetDefault();
      toast.success('Default card updated');
    } catch {
      toast.error('Failed to update default card');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`relative rounded-xl border ${card.is_default ? 'border-primary ring-1 ring-primary' : 'border-border'} p-4 bg-card`}>
      {card.is_default && (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Star className="w-3 h-3 fill-primary" /> Default
        </span>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-7 rounded flex items-center justify-center text-white text-xs font-bold ${CARD_COLORS[card.card_type]}`}>
          {CARD_LOGOS[card.card_type]}
        </div>
        <div>
          <p className="font-medium font-mono tracking-widest">•••• •••• •••• {card.last4}</p>
          <p className="text-xs text-muted-foreground">{card.cardholder_name}</p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Expires {card.expiry_month}/{card.expiry_year}
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={onEdit} disabled={loading} className="gap-1.5">
          <Pencil className="w-3.5 h-3.5" /> Edit
        </Button>
        {!card.is_default && (
          <Button size="sm" variant="outline" onClick={handleSetDefault} disabled={loading} className="gap-1.5">
            <Star className="w-3.5 h-3.5" /> Set default
          </Button>
        )}
        <Button
          size="sm"
          variant={confirming ? 'destructive' : 'ghost'}
          onClick={handleDelete}
          disabled={loading}
          className="gap-1.5 ml-auto"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {confirming ? 'Confirm remove?' : 'Remove'}
        </Button>
        {confirming && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={loading}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Danger Zone ───────────────────────────────────────────────────────────────

function DangerZone() {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const res = await usersAPI.deleteAccount();
      toast.success(`Your account has been deactivated. It will be permanently deleted on ${new Date(res.scheduled_deletion_at).toLocaleDateString()}.`);
      navigate('/');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete account. Please try again.');
    } finally {
      setIsDeleting(false);
      setConfirming(false);
    }
  };

  return (
    <div className="border border-destructive/50 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-destructive" />
        <h2 className="text-xl font-semibold text-destructive">Danger zone</h2>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Deleting your account will deactivate it immediately. Your data is archived for 30 days, during which an admin can reactivate it. After 30 days your account and all associated data will be permanently deleted and cannot be recovered.
      </p>

      {!confirming ? (
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
            <p className="font-semibold mb-1">Are you absolutely sure?</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Your account will be deactivated immediately</li>
              <li>You will be logged out and unable to log back in</li>
              <li>All your listings, bookings, and messages will become inaccessible</li>
              <li>After 30 days your data will be permanently deleted</li>
            </ul>
          </div>
          <div className="flex gap-3">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Yes, delete my account'}
            </Button>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={isDeleting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Account page ─────────────────────────────────────────────────────────

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
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [networkProvider, setNetworkProvider] = useState<'mtn' | 'orange'>('mtn');
  const [otp, setOtp] = useState('');
  const [phoneFlowLoading, setPhoneFlowLoading] = useState(false);

  // Cards state
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<SavedCard | undefined>(undefined);

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

  useEffect(() => {
    if (!user) return;
    cardsAPI.list()
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setCardsLoading(false));
  }, [user]);

  if (!user) return null;

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be smaller than 5MB'); return; }
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    e.target.value = '';
  };

  const handleSave = async () => {
    if (!firstName.trim() || !email.trim()) { toast.error('First name and email are required'); return; }
    setSaving(true);
    try {
      const updated = await usersAPI.updateMyProfile({
        first_name: firstName, last_name: lastName, email, bio,
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
      if (avatarPreview) { URL.revokeObjectURL(avatarPreview); setAvatarPreview(null); }
      toast.success('Profile updated successfully');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleInitiatePhoneChange = async () => {
    if (!newPhoneNumber) { toast.error('New phone number is required'); return; }
    if (user?.hasPassword !== false && !currentPassword) {
      toast.error('Current password is required');
      return;
    }
    setPhoneFlowLoading(true);
    try {
      const payload: Parameters<typeof usersAPI.initiatePhoneChange>[0] = {
        new_phone_number: newPhoneNumber,
        network_provider: networkProvider,
      };
      if (user?.hasPassword !== false) payload.password = currentPassword;
      const res = await usersAPI.initiatePhoneChange(payload);
      toast.success(res.message || 'Verification codes sent');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to start phone change');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  const handleVerifyPhoneChange = async () => {
    if (!otp) { toast.error('Enter the verification code'); return; }
    setPhoneFlowLoading(true);
    try {
      const res = await usersAPI.verifyPhoneChange(otp);
      setPhone(newPhoneNumber);
      setCurrentPassword(''); setOtp(''); setNewPhoneNumber('');
      toast.success(res.message || 'Phone number updated');
    } catch (error: any) {
      toast.error(error?.message || 'Verification failed');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  const handleCancelPhoneChange = async () => {
    setPhoneFlowLoading(true);
    try {
      const res = await usersAPI.cancelPhoneChange();
      setOtp('');
      toast.success(res.message || 'Phone change canceled');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to cancel phone change');
    } finally {
      setPhoneFlowLoading(false);
    }
  };

  // Card helpers
  const openAddCard = () => { setEditingCard(undefined); setCardDialogOpen(true); };
  const openEditCard = (card: SavedCard) => { setEditingCard(card); setCardDialogOpen(true); };

  const handleCardSaved = (card: SavedCard) => {
    setCards(prev => {
      const updated = prev.filter(c => c.id !== card.id);
      if (card.is_default) updated.forEach(c => { c.is_default = false; });
      return [card, ...updated].sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
    });
  };

  const handleCardDeleted = (id: number) => {
    setCards(prev => {
      const remaining = prev.filter(c => c.id !== id);
      if (remaining.length > 0 && !remaining.some(c => c.is_default)) {
        remaining[0] = { ...remaining[0], is_default: true };
      }
      return remaining;
    });
  };

  const handleSetDefault = async (id: number) => {
    try {
      const updated = await cardsAPI.setDefault(id);
      setCards(prev => prev.map(c => ({ ...c, is_default: c.id === updated.id })));
    } catch {
      toast.error('Failed to update default card');
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
              <div className="flex flex-col items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  className="relative w-24 h-24 rounded-full group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Change profile photo"
                >
                  {currentAvatar ? (
                    <img src={currentAvatar} alt={user.firstName} className="w-24 h-24 rounded-full object-cover" />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-2xl font-semibold select-none">
                      {getInitials(user.firstName, user.lastName)}
                    </div>
                  )}
                  <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="w-6 h-6 text-white" />
                  </div>
                </button>
                <button type="button" onClick={handleAvatarClick} className="text-xs text-primary underline underline-offset-2 hover:no-underline">
                  {avatarFile ? avatarFile.name.slice(0, 18) + (avatarFile.name.length > 18 ? '…' : '') : 'Upload photo'}
                </button>
                {avatarFile && (
                  <button type="button" onClick={() => { setAvatarFile(null); if (avatarPreview) { URL.revokeObjectURL(avatarPreview); setAvatarPreview(null); } }} className="text-xs text-destructive underline underline-offset-2">
                    Remove
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" title="Upload profile photo" aria-label="Upload profile photo" className="hidden" onChange={handleFileChange} />
              </div>

              <div className="flex-1 space-y-4 w-full">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName">First name</Label>
                    <Input id="firstName" value={firstName} onChange={e => setFirstName(e.target.value)} className="bg-card border-border" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lastName">Last name</Label>
                    <Input id="lastName" value={lastName} onChange={e => setLastName(e.target.value)} className="bg-card border-border" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} className="bg-card border-border" />
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
                  <Input value={phone || 'No number added yet'} disabled className="bg-muted border-border text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Use the section below to add or change your MoMo number.</p>
                </div>
                <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
                  {saving ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>

          {/* Payment methods */}
          <div className="border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Payment methods</h2>
              <Button size="sm" onClick={openAddCard} className="gap-1.5">
                <Plus className="w-4 h-4" /> Add card
              </Button>
            </div>

            {cardsLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <div key={i} className="h-28 rounded-xl border border-border bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : cards.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-border rounded-xl">
                <CreditCard className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No saved cards yet.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={openAddCard}>
                  <Plus className="w-4 h-4 mr-1.5" /> Add your first card
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {cards.map(card => (
                  <CardTile
                    key={card.id}
                    card={card}
                    onEdit={() => openEditCard(card)}
                    onDelete={() => handleCardDeleted(card.id)}
                    onSetDefault={() => handleSetDefault(card.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Change MoMo Number */}
          <div className="border border-border rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-2">Change Mobile Money Number</h2>
            <p className="text-sm text-muted-foreground mb-6">
              {user?.hasPassword === false
                ? '2-step security flow: we send a 6-digit code to your email and new number → enter it to confirm.'
                : '2-step security flow: confirm your password and new number → enter the 6-digit code we send to your email and new number.'}
            </p>
            <div className="space-y-4">
              <p className="text-sm font-medium text-muted-foreground">Step 1 — Request codes</p>
              <div className="grid sm:grid-cols-2 gap-4">
                {user?.hasPassword !== false && (
                  <div className="space-y-1.5">
                    <Label htmlFor="currentPassword">Current password</Label>
                    <div className="relative">
                      <Input
                        id="currentPassword"
                        type={showCurrentPassword ? 'text' : 'password'}
                        value={currentPassword}
                        onChange={e => setCurrentPassword(e.target.value)}
                        className="bg-card border-border pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPassword(v => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                      >
                        {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="newPhone">New MoMo number</Label>
                  <Input id="newPhone" value={newPhoneNumber} onChange={e => setNewPhoneNumber(e.target.value)} placeholder="e.g. 0880123456" className="bg-card border-border" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="network">Network provider</Label>
                <select id="network" title="Network provider" className="w-full rounded-md border border-border bg-card text-foreground px-3 py-2 text-sm focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring transition-[box-shadow]" value={networkProvider} onChange={e => setNetworkProvider(e.target.value as 'mtn' | 'orange')}>
                  <option value="mtn">MTN Mobile Money</option>
                  <option value="orange">Orange Money</option>
                </select>
              </div>
              <Button onClick={handleInitiatePhoneChange} disabled={phoneFlowLoading}>
                {phoneFlowLoading ? 'Please wait…' : 'Send verification code'}
              </Button>
              <Separator />
              <p className="text-sm font-medium text-muted-foreground">Step 2 — Enter the code</p>
              <div className="space-y-1.5">
                <Label htmlFor="otp">Verification code</Label>
                <Input
                  id="otp"
                  placeholder="6-digit code sent to your email and new number"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                  className="bg-card border-border"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button className="w-full sm:w-auto" onClick={handleVerifyPhoneChange} disabled={phoneFlowLoading}>
                  {phoneFlowLoading ? 'Please wait…' : 'Confirm change'}
                </Button>
                <Button variant="destructive" className="w-full sm:w-auto" onClick={handleCancelPhoneChange} disabled={phoneFlowLoading}>
                  Cancel pending change
                </Button>
              </div>
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
                <Button variant = "outline" onClick={async () => {
                  if (!user?.email) {
                    toast.error("No email on file for this account.");
                    return;
                  }
                  try {
                    const res = await authAPI.passwordResetRequest(user.email);
                    toast.success(res.message);
                  }
                  catch(err:any) {
                    toast.error(err.message || "Failed to send reset email");
                  }
                }}
                >
                  Update 
                </Button>
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
                { label: 'In-app notifications', description: 'Receive booking updates in the app', value: emailNotif, setter: setEmailNotif, field: 'in_app_enabled' },
                { label: 'Message emails', description: 'Get emails when you receive new messages', value: smsNotif, setter: setSmsNotif, field: 'new_message_email' },
                { label: 'Marketing emails', description: 'Receive promotional offers and tips', value: marketingNotif, setter: setMarketingNotif, field: 'search_alert_email' },
              ].map((item, i, arr) => (
                <div key={i}>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">{item.label}</p>
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch
                      checked={item.value}
                      onCheckedChange={async (v) => {
                        item.setter(v);
                        try {
                          await notificationsAPI.updatePreferences({ [item.field]: v });
                          toast.success(`${item.label} ${v ? 'enabled' : 'disabled'}`);
                        } catch {
                          item.setter(!v);
                          toast.error(`Failed to update ${item.label.toLowerCase()}`);
                        }
                      }}
                    />
                  </div>
                  {i < arr.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          </div>

          {/* Danger zone */}
          <DangerZone />

        </div>
      </div>

      <CardFormDialog
        open={cardDialogOpen}
        onClose={() => setCardDialogOpen(false)}
        existing={editingCard}
        onSaved={handleCardSaved}
      />
    </div>
  );
}
