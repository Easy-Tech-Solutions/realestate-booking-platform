import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Users, Plus, ChevronDown, ChevronUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { staffAPI } from '../../services/api/staff';
import type { StaffProfile } from '../../services/api/staff';
import { rbacAPI } from '../../services/api/rbac';
import type { Role, UserRoleAssignment } from '../../services/api/rbac';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getErrorMessage } from '../../services/api/shared/errors';

function OnboardForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [hireDate, setHireDate] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) {
      toast.error('Email is required.');
      return;
    }
    setBusy(true);
    try {
      const result = await staffAPI.adminOnboard({
        email: email.trim(), first_name: firstName.trim(), last_name: lastName.trim(),
        position: position.trim(), department: department.trim(),
        hire_date: hireDate || undefined, phone_number: phone.trim(),
      });
      toast.success(
        result.account_created
          ? `Onboarded ${result.full_name} — a new account was created and a password-reset email was sent to them.`
          : `Onboarded ${result.full_name} — linked to their existing account.`
      );
      setEmail(''); setFirstName(''); setLastName(''); setPosition(''); setDepartment(''); setHireDate(''); setPhone('');
      setOpen(false);
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to onboard staff member'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" /> Onboard staff</Button>;
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          If this email already has an account, the staff profile links to it. Otherwise a new
          account is created and they'll get a password-reset email to set their own credentials.
        </p>
        <div className="grid sm:grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Phone number</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">First name</Label>
            <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Last name</Label>
            <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Position</Label>
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Compliance Officer" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Department</Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Trust & Safety" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Hire date</Label>
            <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? 'Onboarding…' : 'Onboard'}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function RoleAssignment({ userId }: { userId: number }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([]);
  const [selectedRole, setSelectedRole] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [allRoles, userRoles] = await Promise.all([rbacAPI.listRoles(), rbacAPI.listUserRoles(userId)]);
      setRoles(allRoles);
      setAssignments(userRoles);
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load roles'));
    }
  };

  useEffect(() => { load(); }, [userId]);

  const assign = async () => {
    if (!selectedRole) return;
    setBusy(true);
    try {
      await rbacAPI.assignRole(userId, parseInt(selectedRole, 10));
      setSelectedRole('');
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
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to revoke role'));
    }
  };

  const availableRoles = roles.filter((r) => !assignments.some((a) => a.role === r.id));

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">Roles &amp; permissions</p>
      <div className="flex flex-wrap gap-2">
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles assigned.</p>
        ) : (
          assignments.map((a) => (
            <Badge key={a.id} variant="outline" className="flex items-center gap-1">
              {a.role_name}
              <button onClick={() => revoke(a.id)} className="hover:text-destructive"><X className="h-3 w-3" /></button>
            </Badge>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Select value={selectedRole} onValueChange={setSelectedRole}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Add a role…" /></SelectTrigger>
          <SelectContent>
            {availableRoles.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!selectedRole || busy} onClick={assign}>Assign</Button>
      </div>
    </div>
  );
}

function StaffRow({ staff, onChange }: { staff: StaffProfile; onChange: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState(staff.position);
  const [department, setDepartment] = useState(staff.department);
  const [hireDate, setHireDate] = useState(staff.hire_date || '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await staffAPI.adminUpdate(staff.id, { position, department, hire_date: hireDate || undefined });
      toast.success('Updated.');
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update'));
    } finally {
      setBusy(false);
    }
  };

  const offboard = async () => {
    try {
      await staffAPI.adminOffboard(staff.id);
      toast.success(`${staff.full_name} offboarded.`);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to offboard'));
    }
  };

  return (
    <>
      <TableRow className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <TableCell>{staff.full_name}</TableCell>
        <TableCell className="text-sm text-muted-foreground">{staff.email}</TableCell>
        <TableCell>{staff.position || '—'}</TableCell>
        <TableCell>{staff.department || '—'}</TableCell>
        <TableCell>{staff.is_active ? <Badge className="bg-primary/10 text-primary">active</Badge> : <Badge variant="outline">offboarded</Badge>}</TableCell>
        <TableCell>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/30">
            <div className="p-3 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="grid sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Position</Label>
                  <Input value={position} onChange={(e) => setPosition(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Department</Label>
                  <Input value={department} onChange={(e) => setDepartment(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Hire date</Label>
                  <Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={save}>Save</Button>
                {staff.is_active && (
                  <Button size="sm" variant="outline" className="text-destructive" onClick={offboard}>Offboard</Button>
                )}
              </div>

              <RoleAssignment userId={staff.user} />

              <div className="grid sm:grid-cols-2 gap-4 pt-2 border-t border-border/50">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Education</p>
                  {staff.education.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None on file.</p>
                  ) : staff.education.map((e) => (
                    <p key={e.id} className="text-sm">{e.institution} — {e.degree || '—'}</p>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Legal &amp; identification</p>
                  {staff.legal_records.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None on file.</p>
                  ) : staff.legal_records.map((r) => (
                    <p key={r.id} className="text-sm">{r.title} ({r.record_type})</p>
                  ))}
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function AdminStaff() {
  const navigate = useNavigate();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setStaff(await staffAPI.adminList());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have users.staff_management access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Users className="h-5 w-5" /> Staff</h1>
        </div>
        <OnboardForm onDone={load} />
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Position</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                  ) : staff.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No staff onboarded yet.</TableCell></TableRow>
                  ) : (
                    staff.map((s) => <StaffRow key={s.id} staff={s} onChange={load} />)
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
