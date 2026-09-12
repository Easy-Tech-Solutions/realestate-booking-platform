import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Wallet, Send } from 'lucide-react';
import { toast } from 'sonner';
import { payoutsAPI } from '../../services/api/payouts';
import type { Payout } from '../../core/types';
import { agentCommissionsAPI } from '../../services/api/agentCommissions';
import type { AgentCommission } from '../../services/api/agentCommissions';
import { employeesAPI } from '../../services/api/employees';
import type { Employee, EmployeePayment } from '../../services/api/employees';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { formatCurrency } from '../../core/utils';
import { getErrorMessage } from '../../services/api/shared/errors';

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-primary/10 text-primary',
  cancelled: 'bg-gray-100 text-gray-600',
  voided: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-600',
};

function PayoutsSection() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'paid' | 'cancelled' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await payoutsAPI.adminList(statusFilter === 'all' ? undefined : statusFilter);
      setPayouts(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have finances.payouts access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const pay = async (payout: Payout) => {
    setBusyId(payout.id);
    try {
      await payoutsAPI.adminDisburse(payout.id);
      toast.success(`Paid ${payout.hostName} via MTN MoMo.`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Disbursement failed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-md">
          What each host is owed after a guest payment is confirmed. "Pay via MoMo" sends a live
          disbursement to the host's registered MoMo number (or the captured owner number, for
          agent-sourced listings).
        </p>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Listing</TableHead>
                  <TableHead>Net amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : error ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">{error}</TableCell></TableRow>
                ) : payouts.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No payouts match.</TableCell></TableRow>
                ) : (
                  payouts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.hostName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.listingTitle}</TableCell>
                      <TableCell>{formatCurrency(p.netAmount)} {p.currency}</TableCell>
                      <TableCell><Badge className={statusColor[p.status] || ''}>{p.status}</Badge></TableCell>
                      <TableCell>
                        {p.status === 'pending' && (
                          <Button size="sm" disabled={busyId === p.id} onClick={() => pay(p)}>
                            <Send className="h-3.5 w-3.5 mr-1" /> {busyId === p.id ? 'Paying…' : 'Pay via MoMo'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function AgentCommissionsSection() {
  const [commissions, setCommissions] = useState<AgentCommission[]>([]);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'paid' | 'voided' | 'all'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await agentCommissionsAPI.adminList(statusFilter === 'all' ? undefined : statusFilter);
      setCommissions(data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have finances.agent_commissions access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const pay = async (c: AgentCommission) => {
    setBusyId(c.id);
    try {
      await agentCommissionsAPI.adminDisburse(c.id);
      toast.success(`Paid ${c.agent_name} via MTN MoMo.`);
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Disbursement failed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-md">
          Commission owed to a sourcing agent for a confirmed booking on a property they sourced.
        </p>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="voided">Voided</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Listing</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                ) : error ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">{error}</TableCell></TableRow>
                ) : commissions.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No commissions match.</TableCell></TableRow>
                ) : (
                  commissions.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.agent_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.listing_title}</TableCell>
                      <TableCell>{formatCurrency(Number(c.amount))} {c.currency}</TableCell>
                      <TableCell><Badge className={statusColor[c.status] || ''}>{c.status}</Badge></TableCell>
                      <TableCell>
                        {c.status === 'pending' && (
                          <Button size="sm" disabled={busyId === c.id} onClick={() => pay(c)}>
                            <Send className="h-3.5 w-3.5 mr-1" /> {busyId === c.id ? 'Paying…' : 'Pay via MoMo'}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function PayEmployeeDialog({ employee, onDone }: { employee: Employee; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error('A positive amount is required.');
      return;
    }
    setBusy(true);
    try {
      await employeesAPI.adminPay(employee.id, { amount, currency, description: description.trim() });
      toast.success(`Paid ${employee.name} via MTN MoMo.`);
      setOpen(false);
      setAmount(''); setDescription('');
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Disbursement failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button size="sm" onClick={() => setOpen(true)}><Send className="h-3.5 w-3.5 mr-1" /> Pay</Button>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-[320px]">
      <Input placeholder="Amount" className="w-24" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Select value={currency} onValueChange={setCurrency}>
        <SelectTrigger className="w-20"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="USD">USD</SelectItem>
          <SelectItem value="LRD">LRD</SelectItem>
        </SelectContent>
      </Select>
      <Input placeholder="Description (e.g. September salary)" className="w-56" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Button size="sm" disabled={busy} onClick={submit}>{busy ? 'Paying…' : 'Confirm'}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function EmployeesSection() {
  const navigate = useNavigate();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payments, setPayments] = useState<EmployeePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [emps, hist] = await Promise.all([employeesAPI.adminList(), employeesAPI.adminPaymentHistory()]);
      setEmployees(emps);
      setPayments(hist);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have finances.employees access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground max-w-md">
          Adding, editing, or deactivating an employee is managed separately, outside Financial
          Management.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate('/management/employees')}>
          Manage employees
        </Button>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Pay an employee</h3>
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
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No employees yet — add one under "Manage employees" first.
                    </TableCell></TableRow>
                  ) : (
                    employees.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell>{e.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.role_title || '—'}</TableCell>
                        <TableCell>{e.momo_number}</TableCell>
                        <TableCell>
                          <PayEmployeeDialog employee={e} onDone={load} />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Payment history</h3>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No payments yet.</TableCell></TableRow>
                  ) : (
                    payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.employee_name}</TableCell>
                        <TableCell>{formatCurrency(Number(p.amount))} {p.currency}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.description || '—'}</TableCell>
                        <TableCell>
                          <Badge className={statusColor[p.status] || ''}>{p.status}</Badge>
                          {p.status === 'failed' && p.error_message && (
                            <p className="text-xs text-destructive mt-1">{p.error_message}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

export function AdminPayments() {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/management/finance')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
        </Button>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Wallet className="h-5 w-5" /> Payments</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Pay hosts, sourcing agents, and employees directly from here — every "Pay via MoMo" action sends
        a real MTN Mobile Money disbursement.
      </p>

      <Tabs defaultValue="payouts">
        <TabsList>
          <TabsTrigger value="payouts">Host payouts</TabsTrigger>
          <TabsTrigger value="agents">Agent commissions</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
        </TabsList>
        <TabsContent value="payouts" className="pt-4"><PayoutsSection /></TabsContent>
        <TabsContent value="agents" className="pt-4"><AgentCommissionsSection /></TabsContent>
        <TabsContent value="employees" className="pt-4"><EmployeesSection /></TabsContent>
      </Tabs>
    </div>
  );
}
