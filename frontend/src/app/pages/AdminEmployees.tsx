import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Users, Plus, UserX, Wallet, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { employeesAPI } from '../../services/api/employees';
import type { Employee } from '../../services/api/employees';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { getErrorMessage } from '../../services/api/shared/errors';

function EditEmployeeRow({ employee, onDone, onCancel }: { employee: Employee; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(employee.name);
  const [roleTitle, setRoleTitle] = useState(employee.role_title);
  const [momoNumber, setMomoNumber] = useState(employee.momo_number);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim() || !momoNumber.trim()) {
      toast.error('Name and MoMo number are required.');
      return;
    }
    setBusy(true);
    try {
      await employeesAPI.adminUpdate(employee.id, { name: name.trim(), role_title: roleTitle.trim(), momo_number: momoNumber.trim() });
      toast.success('Employee updated.');
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update employee'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableRow>
      <TableCell><Input className="h-8" value={name} onChange={(e) => setName(e.target.value)} /></TableCell>
      <TableCell><Input className="h-8" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} /></TableCell>
      <TableCell><Input className="h-8" value={momoNumber} onChange={(e) => setMomoNumber(e.target.value)} /></TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={save}>Save</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AdminEmployees() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [momoNumber, setMomoNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setEmployees(await employeesAPI.adminList());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have finances.employees access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addEmployee = async () => {
    if (!name.trim() || !momoNumber.trim()) {
      toast.error('Name and MoMo number are required.');
      return;
    }
    setBusy(true);
    try {
      await employeesAPI.adminCreate({ name: name.trim(), momo_number: momoNumber.trim(), role_title: roleTitle.trim() });
      setName(''); setRoleTitle(''); setMomoNumber('');
      toast.success('Employee added.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add employee'));
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (employee: Employee) => {
    try {
      await employeesAPI.adminDeactivate(employee.id);
      toast.success(`${employee.name} deactivated.`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to deactivate employee'));
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Users className="h-5 w-5" /> Employees</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/management/payments')}>
          <Wallet className="h-3.5 w-3.5 mr-1" /> Pay employees
        </Button>
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Add and manage your internal employee roster here. To actually pay someone via MTN MoMo, use
        "Pay employees" above — that's a separate, finance-gated action.
      </p>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Add an employee</h2>
        <Card>
          <CardContent className="p-4 flex flex-wrap gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input className="w-48" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Role/title</Label>
              <Input className="w-40" value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">MoMo number</Label>
              <Input className="w-40" value={momoNumber} onChange={(e) => setMomoNumber(e.target.value)} placeholder="0770123456" />
            </div>
            <Button disabled={busy} onClick={addEmployee}><Plus className="h-3.5 w-3.5 mr-1" /> Add</Button>
          </CardContent>
        </Card>
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Employee roster</h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>MoMo number</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                    ) : employees.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No employees yet.</TableCell></TableRow>
                    ) : (
                      employees.map((e) => (
                        editingId === e.id ? (
                          <EditEmployeeRow key={e.id} employee={e} onDone={() => { setEditingId(null); load(); }} onCancel={() => setEditingId(null)} />
                        ) : (
                          <TableRow key={e.id}>
                            <TableCell>{e.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{e.role_title || '—'}</TableCell>
                            <TableCell>{e.momo_number}</TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Button size="sm" variant="ghost" onClick={() => setEditingId(e.id)}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deactivate(e)}>
                                  <UserX className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
