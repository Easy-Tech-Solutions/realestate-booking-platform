import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import {
  ArrowLeft, Users as UsersIcon, Search, Plus, MoreHorizontal, Eye, UserCog, Ban,
  CheckCircle2, Pencil, Mail, ShieldPlus, Trash2, Skull, Copy,
} from 'lucide-react';
import { adminUsersAPI } from '../../services/api/adminUsers';
import type { AdminUser } from '../../services/api/adminUsers';
import { rbacAPI } from '../../services/api/rbac';
import type { Role, UserRoleAssignment } from '../../services/api/rbac';
import { useApp } from '../../hooks/useApp';
import { getErrorMessage } from '../../services/api/shared/errors';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Skeleton } from '../components/ui/skeleton';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '../components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { BulkActionBar } from '../components/BulkActionBar';

const PAGE_SIZE = 25;

function getInitials(u: AdminUser) {
  return `${u.first_name?.[0] || ''}${u.last_name?.[0] || u.username?.[0] || ''}`.toUpperCase() || '?';
}

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------
function CreateUserDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [role, setRole] = useState<'user' | 'agent'>('user');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);

  const reset = () => {
    setUsername(''); setEmail(''); setFirstName(''); setLastName('');
    setRole('user'); setPassword(''); setGeneratedPassword(null);
  };

  const submit = async () => {
    if (!username.trim() || !email.trim()) {
      toast.error('Username and email are required.');
      return;
    }
    setBusy(true);
    try {
      const created = await adminUsersAPI.create({
        username: username.trim(), email: email.trim(),
        first_name: firstName.trim(), last_name: lastName.trim(),
        role, password: password.trim() || undefined,
      });
      if (created.generated_password) {
        setGeneratedPassword(created.generated_password);
      } else {
        toast.success(`Account "${created.username}" created.`);
        setOpen(false);
        reset();
      }
      onCreated();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to create user'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Create User</Button>
      <DialogContent>
        {generatedPassword ? (
          <>
            <DialogHeader>
              <DialogTitle>Account created</DialogTitle>
              <DialogDescription>
                No password was provided, so one was generated. Share it with the user securely — it won't be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input readOnly value={generatedPassword} className="font-mono" />
              <Button
                type="button" size="icon" variant="outline"
                onClick={() => { navigator.clipboard.writeText(generatedPassword); toast.success('Copied.'); }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => { setOpen(false); reset(); }}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create a user account</DialogTitle>
              <DialogDescription>Admin accounts can't be created here — provision those via the shell.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-2">
                <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
                <Input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Select value={role} onValueChange={(v) => setRole(v as 'user' | 'agent')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Regular user</SelectItem>
                    <SelectItem value="agent">Agent</SelectItem>
                  </SelectContent>
                </Select>
                <Input placeholder="Password (leave blank to auto-generate)" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={busy} onClick={submit}>Create</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit user — profile fields, email, password, all in one modal
// ---------------------------------------------------------------------------
function EditUserDialog({ user, open, onOpenChange, onDone, canGrantAdmin }: {
  user: AdminUser; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void; canGrantAdmin: boolean;
}) {
  const [firstName, setFirstName] = useState(user.first_name);
  const [lastName, setLastName] = useState(user.last_name);
  const [role, setRole] = useState<'user' | 'agent' | 'admin'>(user.role === 'agent' || user.role === 'admin' ? user.role : 'user');
  const [email, setEmail] = useState(user.email);
  const [newPassword, setNewPassword] = useState('');
  const [busyProfile, setBusyProfile] = useState(false);
  const [busyEmail, setBusyEmail] = useState(false);
  const [busyPassword, setBusyPassword] = useState(false);

  useEffect(() => {
    if (open) {
      setFirstName(user.first_name); setLastName(user.last_name);
      setRole(user.role === 'agent' || user.role === 'admin' ? user.role : 'user');
      setEmail(user.email); setNewPassword('');
    }
  }, [open, user]);

  const saveProfile = async () => {
    setBusyProfile(true);
    try {
      await adminUsersAPI.update(user.id, { first_name: firstName, last_name: lastName, role });
      toast.success('Profile updated.');
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update profile'));
    } finally {
      setBusyProfile(false);
    }
  };

  const saveEmail = async () => {
    if (!email.trim() || email.trim() === user.email) return;
    setBusyEmail(true);
    try {
      await adminUsersAPI.changeEmail(user.id, email.trim());
      toast.success('Email updated.');
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to change email'));
    } finally {
      setBusyEmail(false);
    }
  };

  const savePassword = async () => {
    if (!newPassword.trim()) {
      toast.error('Enter a new password first.');
      return;
    }
    setBusyPassword(true);
    try {
      await adminUsersAPI.resetPassword(user.id, newPassword.trim());
      toast.success(`Password reset. ${user.username} has been logged out everywhere.`);
      setNewPassword('');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to reset password'));
    } finally {
      setBusyPassword(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {user.username}</DialogTitle>
          <DialogDescription>Each section below saves independently.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">Profile</p>
            <div className="grid sm:grid-cols-2 gap-2">
              <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <Select value={role} onValueChange={(v) => setRole(v as 'user' | 'agent' | 'admin')} disabled={user.role === 'superadmin'}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Regular user</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  {(canGrantAdmin || user.role === 'admin') && <SelectItem value="admin">Admin</SelectItem>}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={busyProfile || user.role === 'superadmin'} onClick={saveProfile}>Save profile</Button>
            </div>
            {user.role === 'superadmin' && <p className="text-xs text-muted-foreground">Superadmin accounts are managed via the shell, not this dashboard.</p>}
            {role === 'admin' && user.role !== 'admin' && <p className="text-xs text-muted-foreground">Granting Admin gives broad access to every part of the platform (see the "Admin" role under Roles & Permissions for exactly what's included).</p>}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Email</p>
            <div className="flex items-center gap-2">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Button size="sm" disabled={busyEmail} onClick={saveEmail}>Save email</Button>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Reset password</p>
            <p className="text-xs text-muted-foreground">Sets the password directly and logs the user out of every device.</p>
            <div className="flex items-center gap-2">
              <Input type="text" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <Button size="sm" variant="outline" disabled={busyPassword} onClick={savePassword}>Set password</Button>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Manage roles for a single user
// ---------------------------------------------------------------------------
function ManageRolesDialog({ user, open, onOpenChange, roles }: {
  user: AdminUser; open: boolean; onOpenChange: (v: boolean) => void; roles: Role[];
}) {
  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([]);
  const [roleId, setRoleId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setAssignments(await rbacAPI.listUserRoles(user.id));
    } catch {
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open) load(); }, [open, user.id]);

  const assign = async () => {
    if (!roleId) return;
    setBusy(true);
    try {
      await rbacAPI.assignRole(user.id, Number(roleId));
      toast.success('Role assigned.');
      setRoleId('');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to assign role'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (assignmentId: number) => {
    try {
      await rbacAPI.revokeRole(assignmentId);
      toast.success('Role revoked.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to revoke role'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Roles for {user.username}</DialogTitle>
          <DialogDescription>Assigning any role marks the account is_staff so they can reach this dashboard.</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles assigned yet.</p>
        ) : (
          <div className="space-y-1.5">
            {assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-sm">
                <span>{a.role_name}</span>
                <Button size="icon" variant="ghost" onClick={() => revoke(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <select className="flex-1 text-sm border border-border rounded-lg px-2 py-2 bg-background" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">Select a role to assign…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <Button size="sm" disabled={busy || !roleId} onClick={assign}>Assign</Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------
function SoftDeleteDialog({ user, open, onOpenChange, onDone }: {
  user: AdminUser; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!reason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    setBusy(true);
    try {
      const result = await adminUsersAPI.softDelete(user.id, reason.trim());
      toast.success(result.message);
      onOpenChange(false);
      setReason('');
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to delete user'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {user.username}?</DialogTitle>
          <DialogDescription>
            This deactivates the account and anonymizes their name/email/username. Booking, payment, and review
            history is preserved for records. This is reversible only by support intervention.
          </DialogDescription>
        </DialogHeader>
        <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={confirm}>Delete (soft)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Hard delete — permanent, guarded
// ---------------------------------------------------------------------------
function HardDeleteDialog({ user, open, onOpenChange, onDone }: {
  user: AdminUser; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [confirmUsername, setConfirmUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    if (open) { setReason(''); setConfirmUsername(''); setBlocked(null); }
  }, [open]);

  const attempt = async (force: boolean) => {
    if (!reason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    if (confirmUsername.trim() !== user.username) {
      toast.error(`Type "${user.username}" to confirm.`);
      return;
    }
    setBusy(true);
    try {
      const result = await adminUsersAPI.hardDelete(user.id, reason.trim(), force);
      if (result.pending_approval) {
        toast.success('A second admin must approve this permanent deletion before it executes.');
      } else {
        toast.success(result.message || 'User permanently deleted.');
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      const data = (err as { data?: { protected_records?: Record<string, number> } })?.data;
      if (data?.protected_records) {
        setBlocked(data.protected_records);
      } else {
        toast.error(getErrorMessage(err, 'Failed to delete user'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2"><Skull className="h-4 w-4" /> Permanently delete {user.username}</DialogTitle>
          <DialogDescription>
            This is a real, irreversible database delete — not a deactivation. If this account has any booking,
            payment, or listing history, it will require a second admin's approval.
          </DialogDescription>
        </DialogHeader>

        {blocked && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-1">
            <p className="font-medium text-destructive">This account has related records:</p>
            <ul className="list-disc list-inside text-muted-foreground">
              {Object.entries(blocked).map(([k, v]) => <li key={k}>{k.replace(/_/g, ' ')}: {v}</li>)}
            </ul>
            <p className="text-xs text-muted-foreground pt-1">Proceeding will submit this for a second admin to approve — it won't execute immediately.</p>
          </div>
        )}

        <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        <Input placeholder={`Type "${user.username}" to confirm`} value={confirmUsername} onChange={(e) => setConfirmUsername(e.target.value)} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {blocked ? (
            <Button variant="destructive" disabled={busy} onClick={() => attempt(true)}>Force delete (needs 2nd admin)</Button>
          ) : (
            <Button variant="destructive" disabled={busy} onClick={() => attempt(false)}>Permanently delete</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Per-row actions dropdown
// ---------------------------------------------------------------------------
function UserRowActions({ user, roles, onDone }: { user: AdminUser; roles: Role[]; onDone: () => void }) {
  const navigate = useNavigate();
  const { startImpersonation, user: currentAdmin } = useApp();
  const [dialog, setDialog] = useState<'edit' | 'roles' | 'softDelete' | 'hardDelete' | null>(null);

  const impersonate = async () => {
    const reason = window.prompt(`Why are you viewing ${user.username}'s account? (required, logged to the audit trail)`);
    if (!reason || !reason.trim()) return;
    try {
      await startImpersonation(String(user.id), reason.trim());
      toast.success(`Now viewing as ${user.username}`);
      navigate('/');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to start impersonation'));
    }
  };

  const toggleActive = async () => {
    try {
      await adminUsersAPI.toggleActive(user.id, !user.is_active);
      toast.success(user.is_active ? `${user.username} deactivated.` : `${user.username} reactivated.`);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update account status'));
    }
  };

  const isSuperadminTarget = user.role === 'superadmin';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{user.username}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate(`/users/${user.id}`)}>
            <Eye className="h-3.5 w-3.5 mr-2" /> View profile
          </DropdownMenuItem>
          {currentAdmin?.isAdmin && !isSuperadminTarget && (
            <DropdownMenuItem onClick={impersonate}>
              <UserCog className="h-3.5 w-3.5 mr-2" /> View as
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setDialog('edit')} disabled={isSuperadminTarget}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Edit profile / email / password
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setDialog('roles')}>
            <ShieldPlus className="h-3.5 w-3.5 mr-2" /> Manage roles
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={toggleActive} disabled={isSuperadminTarget && user.is_active}>
            {user.is_active ? <Ban className="h-3.5 w-3.5 mr-2" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-2" />}
            {user.is_active ? 'Deactivate' : 'Reactivate'}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDialog('softDelete')} disabled={isSuperadminTarget}>
            <Mail className="h-3.5 w-3.5 mr-2" /> Delete (soft — preserves history)
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDialog('hardDelete')} disabled={isSuperadminTarget}>
            <Skull className="h-3.5 w-3.5 mr-2" /> Delete permanently
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === 'edit' && (
        <EditUserDialog user={user} open onOpenChange={(v) => !v && setDialog(null)} onDone={onDone} canGrantAdmin={Boolean(currentAdmin?.isSuperadmin)} />
      )}
      {dialog === 'roles' && (
        <ManageRolesDialog user={user} roles={roles} open onOpenChange={(v) => !v && setDialog(null)} />
      )}
      {dialog === 'softDelete' && (
        <SoftDeleteDialog user={user} open onOpenChange={(v) => !v && setDialog(null)} onDone={onDone} />
      )}
      {dialog === 'hardDelete' && (
        <HardDeleteDialog user={user} open onOpenChange={(v) => !v && setDialog(null)} onDone={onDone} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bulk role assign/remove dialog
// ---------------------------------------------------------------------------
function BulkRoleDialog({ mode, userIds, roles, open, onOpenChange, onDone }: {
  mode: 'assign' | 'remove'; userIds: number[]; roles: Role[];
  open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!roleId) {
      toast.error('Select a role first.');
      return;
    }
    setBusy(true);
    try {
      const result = await adminUsersAPI.bulkAction({
        action: mode === 'assign' ? 'assign_role' : 'remove_role',
        user_ids: userIds, role_id: Number(roleId),
      });
      toast.success(`${result.succeeded.length} succeeded, ${result.failed.length} failed.`);
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Bulk action failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'assign' ? 'Assign role to' : 'Remove role from'} {userIds.length} user(s)</DialogTitle>
        </DialogHeader>
        <select className="w-full text-sm border border-border rounded-lg px-2 py-2 bg-background" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">Select a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={busy || !roleId} onClick={submit}>{mode === 'assign' ? 'Assign' : 'Remove'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function AdminUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('all');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [roles, setRoles] = useState<Role[]>([]);
  const [bulkDialog, setBulkDialog] = useState<'assign' | 'remove' | null>(null);
  const [bulkSoftDeleteOpen, setBulkSoftDeleteOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminUsersAPI.list({
        search: search.trim() || undefined,
        role: roleFilter === 'all' ? undefined : roleFilter,
        is_active: activeFilter === 'all' ? undefined : activeFilter === 'active',
        page, page_size: PAGE_SIZE,
      });
      setUsers(res.results);
      setCount(res.count);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have Users access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, roleFilter, activeFilter]);
  useEffect(() => { rbacAPI.listRoles().then(setRoles).catch(() => setRoles([])); }, []);

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => (prev.size === users.length ? new Set() : new Set(users.map((u) => u.id))));
  };

  const clearSelection = () => setSelected(new Set());

  const bulkToggleActive = async (isActive: boolean) => {
    setBulkBusy(true);
    try {
      const result = await adminUsersAPI.bulkAction({ action: isActive ? 'reactivate' : 'deactivate', user_ids: [...selected] });
      toast.success(`${result.succeeded.length} succeeded, ${result.failed.length} failed.`);
      clearSelection();
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Bulk action failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSoftDelete = async () => {
    if (!bulkReason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    setBulkBusy(true);
    try {
      const result = await adminUsersAPI.bulkAction({ action: 'soft_delete', user_ids: [...selected], reason: bulkReason.trim() });
      toast.success(`${result.succeeded.length} succeeded, ${result.failed.length} failed.`);
      setBulkSoftDeleteOpen(false);
      setBulkReason('');
      clearSelection();
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Bulk delete failed'));
    } finally {
      setBulkBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><UsersIcon className="h-5 w-5" /> User Management</h1>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search username, email, name…"
              className="pl-10 w-64"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load(); } }}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => { setPage(1); load(); }}>Search</Button>
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="superadmin">Superadmin</SelectItem>
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={(v) => { setActiveFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CreateUserDialog onCreated={load} />
      </div>

      <BulkActionBar selectedCount={selected.size} onClear={clearSelection}>
        <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkToggleActive(true)}>Reactivate</Button>
        <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkToggleActive(false)}>Deactivate</Button>
        <Button size="sm" variant="outline" onClick={() => setBulkDialog('assign')}>Assign role…</Button>
        <Button size="sm" variant="outline" onClick={() => setBulkDialog('remove')}>Remove role…</Button>
        <Button size="sm" variant="destructive" onClick={() => setBulkSoftDeleteOpen(true)}>Delete (soft)…</Button>
      </BulkActionBar>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={users.length > 0 && selected.size === users.length} onCheckedChange={toggleAll} />
                  </TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(6)].map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                    </TableRow>
                  ))
                ) : error ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{error}</TableCell></TableRow>
                ) : users.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No users match.</TableCell></TableRow>
                ) : (
                  users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <Checkbox checked={selected.has(u.id)} onCheckedChange={() => toggleOne(u.id)} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar><AvatarFallback>{getInitials(u)}</AvatarFallback></Avatar>
                          <div>
                            <p className="font-medium">{u.first_name} {u.last_name}</p>
                            <p className="text-sm text-muted-foreground">{u.email || u.username}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.role === 'superadmin' ? 'destructive' : u.role === 'admin' ? 'default' : u.role === 'agent' ? 'secondary' : 'outline'}>{u.role}</Badge>
                        {u.is_staff && <Badge variant="outline" className="ml-1 text-[10px]">staff</Badge>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.is_active ? 'secondary' : 'destructive'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                        {u.deleted_at && <Badge variant="outline" className="ml-1 text-[10px]">deleted</Badge>}
                      </TableCell>
                      <TableCell>{new Date(u.date_joined).toLocaleDateString()}</TableCell>
                      <TableCell>
                        <UserRowActions user={u} roles={roles} onDone={load} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {!loading && !error && count > 0 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{count} user{count === 1 ? '' : 's'} · page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {bulkDialog && (
        <BulkRoleDialog
          mode={bulkDialog} userIds={[...selected]} roles={roles}
          open onOpenChange={(v) => !v && setBulkDialog(null)}
          onDone={() => { clearSelection(); load(); }}
        />
      )}

      <Dialog open={bulkSoftDeleteOpen} onOpenChange={setBulkSoftDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selected.size} user(s)?</DialogTitle>
            <DialogDescription>
              Deactivates and anonymizes each account. Booking/payment history is preserved. Admin accounts in the
              selection are skipped automatically.
            </DialogDescription>
          </DialogHeader>
          <Textarea placeholder="Reason (required)" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} rows={2} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkSoftDeleteOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={bulkBusy} onClick={bulkSoftDelete}>Delete selected</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
