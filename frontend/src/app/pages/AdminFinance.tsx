import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, DollarSign, Download, ScrollText, Lock, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { paymentAPI, REFUND_REASON_OPTIONS } from '../../services/api/payments';
import type { EscrowBooking, TaxRate, TaxReportBucket, RefundReasonCode } from '../../services/api/payments';
import { bookingsAPI } from '../../services/api/bookings';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { formatCurrency } from '../../core/utils';
import { getErrorMessage } from '../../services/api/shared/errors';

interface Transaction {
  id: string;
  purpose: string;
  gateway_name: string;
  customer_username: string;
  amount: string;
  currency_code: string;
  status: string;
  created_at: string;
}

const statusColor: Record<string, string> = {
  completed: 'bg-primary/10 text-primary',
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-yellow-100 text-yellow-700',
  failed: 'bg-red-100 text-red-600',
  cancelled: 'bg-gray-100 text-gray-600',
  refunded: 'bg-orange-100 text-orange-700',
  partially_refunded: 'bg-orange-100 text-orange-700',
};

function RefundDialog({ tx, onDone }: { tx: Transaction; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState<RefundReasonCode>('other');
  const [busy, setBusy] = useState(false);

  const refundable = tx.gateway_name === 'mtn_momo' && (tx.status === 'completed' || tx.status === 'partially_refunded');
  if (!refundable) return null;

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0 || !reason.trim()) {
      toast.error('A positive amount and a reason are required.');
      return;
    }
    if (reasonCode === 'change_of_mind') {
      toast.error('Change of mind is not an eligible refund reason.');
      return;
    }
    setBusy(true);
    try {
      await paymentAPI.adminRefund(tx.id, amt, reason.trim(), reasonCode);
      toast.success('Refund submitted.');
      setOpen(false);
      setAmount('');
      setReason('');
      setReasonCode('other');
      onDone();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Refund failed'));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Refund</Button>;
  }

  return (
    <div className="flex flex-col gap-2 min-w-[220px]">
      <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as RefundReasonCode)}>
        <SelectTrigger><SelectValue placeholder="Reason code" /></SelectTrigger>
        <SelectContent>
          {REFUND_REASON_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      <div className="flex gap-2">
        <Button size="sm" variant="destructive" disabled={busy} onClick={submit}>Confirm refund</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function EscrowSection() {
  const [bookings, setBookings] = useState<EscrowBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdReason, setHoldReason] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setBookings(await paymentAPI.adminListEscrow());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have finances.escrow access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const placeHold = async (bookingId: number) => {
    const reason = (holdReason[bookingId] || '').trim();
    if (!reason) {
      toast.error('A reason is required to place a hold.');
      return;
    }
    setBusyId(bookingId);
    try {
      await paymentAPI.adminHoldEscrow(bookingId, reason);
      toast.success('Hold placed — this booking cannot be confirmed until released.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to place hold'));
    } finally {
      setBusyId(null);
    }
  };

  const release = async (holdId: number, bookingId: number) => {
    setBusyId(bookingId);
    try {
      await paymentAPI.adminReleaseEscrow(holdId);
      toast.success('Hold released.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to release hold'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Escrow — held guest payments</h2>
      <p className="text-xs text-muted-foreground">
        Bookings whose payment has landed but isn't confirmed/disbursed yet. Placing a hold blocks
        payment confirmation — use it while a fraud flag or dispute on the booking is under investigation.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No bookings currently awaiting confirmation.</p>
      ) : (
        <div className="space-y-2">
          {bookings.map((b) => (
            <Card key={b.booking_id}>
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-sm flex items-center gap-2">
                    Booking #{b.booking_id} — {b.listing_title}
                    {b.on_hold && <Badge variant="destructive">on hold</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {b.guest_username} · {b.total_price ? formatCurrency(Number(b.total_price)) : '—'}
                    {b.on_hold && b.hold_reason && ` · ${b.hold_reason}`}
                  </p>
                </div>
                {b.on_hold ? (
                  <Button size="sm" variant="outline" disabled={busyId === b.booking_id} onClick={() => release(b.hold_id!, b.booking_id)}>
                    <Unlock className="h-3.5 w-3.5 mr-1" /> Release
                  </Button>
                ) : (
                  <div className="flex gap-2 items-center">
                    <Input
                      placeholder="Hold reason"
                      className="w-48 h-8 text-sm"
                      value={holdReason[b.booking_id] || ''}
                      onChange={(e) => setHoldReason((prev) => ({ ...prev, [b.booking_id]: e.target.value }))}
                    />
                    <Button size="sm" variant="outline" disabled={busyId === b.booking_id} onClick={() => placeHold(b.booking_id)}>
                      <Lock className="h-3.5 w-3.5 mr-1" /> Hold
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function TaxRatesSection() {
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [report, setReport] = useState<TaxReportBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jurisdiction, setJurisdiction] = useState('');
  const [ratePercent, setRatePercent] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [ratesRes, reportRes] = await Promise.all([paymentAPI.adminListTaxRates(), paymentAPI.adminTaxReport()]);
      setRates(ratesRes);
      setReport(reportRes.by_jurisdiction);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have finances.taxes access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!jurisdiction.trim() || !ratePercent.trim()) {
      toast.error('Jurisdiction and rate are required.');
      return;
    }
    setBusy(true);
    try {
      await paymentAPI.adminCreateTaxRate({ jurisdiction: jurisdiction.trim(), rate_percent: ratePercent.trim() });
      setJurisdiction(''); setRatePercent('');
      toast.success('Tax rate added.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to add tax rate'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (rate: TaxRate) => {
    try {
      await paymentAPI.adminUpdateTaxRate(rate.id, { is_active: !rate.is_active });
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to update rate'));
    }
  };

  const remove = async (id: number) => {
    try {
      await paymentAPI.adminDeleteTaxRate(id);
      toast.success('Tax rate removed.');
      load();
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to remove rate'));
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Occupancy tax</h2>
      <p className="text-xs text-muted-foreground">
        Per-jurisdiction rates matched against each listing's city. No withholding/filing/remittance —
        just a real computed liability over confirmed bookings, for your own records.
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Input placeholder="Jurisdiction (city)" className="w-48" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} />
            <Input placeholder="Rate % (e.g. 5.00)" className="w-32" value={ratePercent} onChange={(e) => setRatePercent(e.target.value)} />
            <Button size="sm" disabled={busy} onClick={create}>Add rate</Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Rates</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {rates.length === 0 ? <p className="text-sm text-muted-foreground">No tax rates configured.</p> : rates.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-sm border-b border-border/50 pb-1.5">
                    <span>{r.jurisdiction} — {r.rate_percent}%</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => toggleActive(r)}>{r.is_active ? 'Deactivate' : 'Activate'}</Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(r.id)}>Remove</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Computed liability (all time)</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {report.length === 0 ? <p className="text-sm text-muted-foreground">No confirmed bookings in a taxed jurisdiction yet.</p> : report.map((b) => (
                  <div key={b.jurisdiction} className="text-sm border-b border-border/50 pb-1.5">
                    <p className="font-medium">{b.jurisdiction}</p>
                    <p className="text-xs text-muted-foreground">{b.booking_count} booking(s) · gross {formatCurrency(Number(b.gross_total))} · tax {formatCurrency(Number(b.tax_liability))}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </section>
  );
}

function StripeRefundSection() {
  const [bookingId, setBookingId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState<RefundReasonCode>('other');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const id = parseInt(bookingId, 10);
    const amt = parseFloat(amount);
    if (!id || !amt || amt <= 0 || !reason.trim()) {
      toast.error('Booking ID, a positive amount, and a reason are required.');
      return;
    }
    if (reasonCode === 'change_of_mind') {
      toast.error('Change of mind is not an eligible refund reason.');
      return;
    }
    setBusy(true);
    try {
      const result = await paymentAPI.adminStripeRefund(id, amt, reason.trim(), reasonCode);
      toast.success(result.message);
      setBookingId(''); setAmount(''); setReason(''); setReasonCode('other');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to submit refund request'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Stripe refunds</h2>
      <p className="text-xs text-muted-foreground">
        Only for bookings paid via Stripe (property rent payments). Every Stripe refund — regardless of
        amount — requires a second admin's approval under Roles & Permissions → Pending Approvals before
        it executes.
      </p>
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Booking ID</label>
            <Input className="w-28" value={bookingId} onChange={(e) => setBookingId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Amount (USD)</label>
            <Input className="w-32" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground">Reason code</label>
            <Select value={reasonCode} onValueChange={(v) => setReasonCode(v as RefundReasonCode)}>
              <SelectTrigger><SelectValue placeholder="Reason code" /></SelectTrigger>
              <SelectContent>
                {REFUND_REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <Textarea rows={1} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button disabled={busy} onClick={submit}>Request refund</Button>
        </CardContent>
      </Card>
    </section>
  );
}

function ExtendReservationSection() {
  const [bookingId, setBookingId] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const id = parseInt(bookingId, 10);
    if (!id || !newDeadline || !reason.trim()) {
      toast.error('Booking ID, a new deadline, and a reason are required.');
      return;
    }
    setBusy(true);
    try {
      const result = await bookingsAPI.adminExtendReservation(id, new Date(newDeadline).toISOString(), reason.trim());
      toast.success(result.message);
      setBookingId(''); setNewDeadline(''); setReason('');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to extend reservation'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Extend a reservation</h2>
      <p className="text-xs text-muted-foreground">
        Pushes out whichever clock is currently active for the booking — the host-confirm deadline or the
        payment deadline. Capped at 20 days total from the original reservation request, per policy.
      </p>
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Booking ID</label>
            <Input className="w-28" value={bookingId} onChange={(e) => setBookingId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">New deadline</label>
            <Input type="datetime-local" className="w-56" value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Reason</label>
            <Textarea rows={1} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button disabled={busy} onClick={submit}>Extend</Button>
        </CardContent>
      </Card>
    </section>
  );
}

export function AdminFinance() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<any>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [summaryRes, txRes] = await Promise.all([
        paymentAPI.adminFinancialSummary(),
        paymentAPI.adminTransactions({
          limit: '25',
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(search.trim() ? { search: search.trim() } : {}),
        }),
      ]);
      setSummary(summaryRes);
      setTransactions(txRes.results || []);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'You do not have Finance & Legal access.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const runExport = async () => {
    setExporting(true);
    try {
      await paymentAPI.adminExportTransactionsCsv({
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      });
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/management')}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><DollarSign className="h-5 w-5" /> Finance & Legal Center</h1>
        </div>
        <Button variant="outline" onClick={() => navigate('/management/legal-documents')}>
          <ScrollText className="h-3.5 w-3.5 mr-1" /> Legal Documents
        </Button>
      </div>

      {error ? (
        <p className="text-sm text-muted-foreground">{error}</p>
      ) : (
        <>
          <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Gross collected</p><p className="text-xl font-semibold">{summary ? formatCurrency(Number(summary.gross_collected)) : '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Total refunded</p><p className="text-xl font-semibold text-destructive">{summary ? formatCurrency(Number(summary.total_refunded)) : '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Net revenue</p><p className="text-xl font-semibold">{summary ? formatCurrency(Number(summary.net_revenue)) : '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Commission revenue</p><p className="text-xl font-semibold text-primary">{summary ? formatCurrency(Number(summary.commission_revenue)) : '—'}</p></CardContent></Card>
          </section>
          {summary && (
            <section className="grid sm:grid-cols-3 gap-3">
              <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Payouts pending</p><p className="text-lg font-semibold">{formatCurrency(Number(summary.payouts.pending_total))} <span className="text-xs text-muted-foreground">({summary.payouts.pending_count})</span></p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Payouts paid</p><p className="text-lg font-semibold">{formatCurrency(Number(summary.payouts.paid_total))} <span className="text-xs text-muted-foreground">({summary.payouts.paid_count})</span></p></CardContent></Card>
              <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Payouts cancelled</p><p className="text-lg font-semibold">{summary.payouts.cancelled_count}</p></CardContent></Card>
            </section>
          )}

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Transactions</h2>
              <div className="flex items-center gap-2">
                <Input placeholder="Search user / transaction ID" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') load(); }} className="w-56" />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                    <SelectItem value="partially_refunded">Partially refunded</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" disabled={exporting} onClick={runExport}>
                  <Download className="h-3.5 w-3.5 mr-1" /> {exporting ? 'Exporting…' : 'Export CSV'}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Refunds from this table only support MTN MoMo payments — use the Stripe refunds section
              below for property rent payments made via Stripe.
            </p>
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Customer</TableHead>
                        <TableHead>Gateway</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
                      ) : transactions.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No transactions match.</TableCell></TableRow>
                      ) : (
                        transactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell>{tx.customer_username}</TableCell>
                            <TableCell><Badge variant="outline">{tx.gateway_name}</Badge></TableCell>
                            <TableCell>{formatCurrency(Number(tx.amount))} {tx.currency_code}</TableCell>
                            <TableCell><Badge className={statusColor[tx.status] || ''}>{tx.status}</Badge></TableCell>
                            <TableCell className="text-sm">{new Date(tx.created_at).toLocaleDateString()}</TableCell>
                            <TableCell><RefundDialog tx={tx} onDone={load} /></TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </section>

          <StripeRefundSection />
          <ExtendReservationSection />
          <EscrowSection />
          <TaxRatesSection />
        </>
      )}
    </div>
  );
}
