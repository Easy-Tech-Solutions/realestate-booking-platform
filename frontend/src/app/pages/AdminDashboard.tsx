import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2, CheckCircle, DollarSign, Home, TrendingUp, Users,
  Search, Eye, X, Shield, Settings, BarChart3, Calendar,
  CreditCard, RefreshCw, Headphones, Mail, ChevronDown, ChevronUp, ChevronRight, UserCheck,
  ScrollText, KeyRound, ShieldCheck, Cpu, KeySquare,
} from 'lucide-react';
import { supportAPI, SupportTicket, ContactInquiry } from '../../services/api/support';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Skeleton } from '../components/ui/skeleton';
import { formatCurrency } from '../../core/utils';
import { toast } from 'sonner';
import { usersAPI, propertiesAPI, bookingsAPI, payoutsAPI, paymentAPI } from '../../services/api';
import type { PlatformFee, EscrowBooking } from '../../services/api/payments';
import { useApp } from '../../hooks/useApp';
import { MfaSetupCard } from '../components/MfaSetupCard';
import { CommunicationsDialog } from '../components/CommunicationsDialog';
import type { Booking, Payout } from '../../core/types';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
  SidebarProvider, SidebarTrigger,
} from '../components/ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../components/ui/collapsible';

type NavLeaf =
  | { type: 'section'; id: string; label: string }
  | { type: 'route'; path: string; label: string };

interface NavGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  items: NavLeaf[];
}

const navGroups: NavGroup[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3, items: [
    { type: 'section', id: 'overview', label: 'Overview' },
  ] },
  { id: 'users', label: 'User Management', icon: Users, items: [
    { type: 'route', path: '/management/users', label: 'All Users' },
  ] },
  { id: 'inventory', label: 'Property & Inventory', icon: Building2, items: [
    { type: 'section', id: 'properties', label: 'Property Management' },
    { type: 'route', path: '/management/listing-moderation', label: 'Listing Moderation' },
  ] },
  { id: 'bookings', label: 'Bookings', icon: Calendar, items: [
    { type: 'section', id: 'bookings', label: 'All Bookings' },
  ] },
  { id: 'finance', label: 'Financial Management', icon: DollarSign, items: [
    { type: 'section', id: 'payments', label: 'Payments' },
    { type: 'section', id: 'payouts', label: 'Host Payouts' },
    { type: 'route', path: '/management/finance', label: 'Finance & Legal Center' },
    { type: 'route', path: '/management/legal-documents', label: 'Legal Documents' },
  ] },
  { id: 'trust_safety', label: 'Trust & Safety', icon: ShieldCheck, items: [
    { type: 'section', id: 'trust_safety', label: 'Overview' },
    { type: 'route', path: '/management/kyc-queue', label: 'KYC Review Queue' },
    { type: 'route', path: '/management/fraud-flags', label: 'Fraud & AML' },
    { type: 'route', path: '/management/suspensions', label: 'Suspensions Center' },
  ] },
  { id: 'support', label: 'Support', icon: Headphones, items: [
    { type: 'section', id: 'support', label: 'Support Tickets' },
    { type: 'route', path: '/management/reports', label: 'Reports Center' },
    { type: 'route', path: '/management/aircover-claims', label: 'AirCover Claims' },
  ] },
  { id: 'rbac', label: 'Roles & Permissions', icon: KeySquare, items: [
    { type: 'route', path: '/management/roles', label: 'Roles & Custom Roles' },
    { type: 'route', path: '/management/approvals', label: 'Pending Approvals' },
    { type: 'route', path: '/management/break-glass', label: 'Break-Glass Access' },
  ] },
  { id: 'security', label: 'Security', icon: Shield, items: [
    { type: 'section', id: 'security', label: 'Overview & MFA' },
    { type: 'route', path: '/management/audit-log', label: 'Audit Log' },
  ] },
  { id: 'platform', label: 'Platform & Engineering', icon: Cpu, items: [
    { type: 'route', path: '/management/platform-ops', label: 'Feature Flags & Health' },
  ] },
  { id: 'settings', label: 'Settings', icon: Settings, items: [
    { type: 'section', id: 'settings', label: 'Platform Settings' },
  ] },
];

const sectionLabels: Record<string, string> = navGroups
  .flatMap((g) => g.items)
  .filter((i): i is Extract<NavLeaf, { type: 'section' }> => i.type === 'section')
  .reduce((acc, i) => ({ ...acc, [i.id]: i.label }), {});

const statusColor: Record<string, string> = {
  confirmed:  'bg-primary/10 text-primary',
  requested:  'bg-yellow-100 text-yellow-700',
  completed:  'bg-gray-100 text-gray-600',
  cancelled:  'bg-red-100 text-red-600',
  declined:   'bg-red-100 text-red-600',
};

const paymentStatusColor: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  pending:   'bg-yellow-100 text-yellow-700',
  failed:    'bg-red-100 text-red-600',
};

function StatCard({ label, value, icon: Icon, sub }: { label: string; value: string | number; icon: React.ElementType; sub?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const { user: currentAdmin } = useApp();
  const [activeSection, setActiveSection] = useState('overview');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(navGroups.map((g) => g.id))
  );
  const toggleGroup = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Data state
  const [stats, setStats]           = useState<any>(null);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [propSearch, setPropSearch] = useState('');
  const [pendingListings, setPendingListings] = useState<any[]>([]);
  const [propTab, setPropTab] = useState<'published' | 'pending'>('published');

  // Settings state
  const [platformFee, setPlatformFee] = useState<PlatformFee | null>(null);
  const [platformFeeDraft, setPlatformFeeDraft] = useState<Partial<PlatformFee>>({});
  const [platformFeeLoading, setPlatformFeeLoading] = useState(false);
  const [platformFeeSaving, setPlatformFeeSaving] = useState(false);

  // Support state
  const [supportTickets, setSupportTickets]     = useState<SupportTicket[]>([]);
  const [supportStats, setSupportStats]         = useState<any>(null);
  const [contactInquiries, setContactInquiries] = useState<ContactInquiry[]>([]);
  const [supportLoading, setSupportLoading]     = useState(false);
  const [ticketFilter, setTicketFilter]         = useState('');
  const [expandedTicket, setExpandedTicket]     = useState<number | null>(null);
  const [assignInput, setAssignInput]           = useState('');
  const [supportTab, setSupportTab]             = useState<'tickets' | 'contact'>('tickets');
  const [ticketDetails, setTicketDetails]       = useState<Record<number, SupportTicket>>({});
  const [ticketDetailLoading, setTicketDetailLoading] = useState<number | null>(null);
  const [replyDraft, setReplyDraft]             = useState<Record<number, string>>({});
  const [escalateDraft, setEscalateDraft]       = useState<Record<number, string>>({});

  // Payments awaiting confirmation + host payouts
  const [paymentReceived, setPaymentReceived] = useState<Booking[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutTab, setPayoutTab] = useState<'pending' | 'paid' | 'cancelled'>('pending');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [escrowByBooking, setEscrowByBooking] = useState<Record<string, EscrowBooking>>({});

  const loadPaymentsAndPayouts = useCallback(async () => {
    const [pr, po, escrow] = await Promise.all([
      bookingsAPI.getPaymentReceived().catch(() => [] as Booking[]),
      payoutsAPI.adminList().catch(() => [] as Payout[]),
      paymentAPI.adminListEscrow().catch(() => [] as EscrowBooking[]),
    ]);
    setPaymentReceived(pr);
    setPayouts(po);
    setEscrowByBooking(Object.fromEntries(escrow.map((e) => [String(e.booking_id), e])));
  }, []);

  const handleConfirmPayment = async (id: string) => {
    setActionBusyId(id);
    try {
      await bookingsAPI.confirmPayment(id);
      toast.success('Payment confirmed — host contact shared and payout created.');
      await loadPaymentsAndPayouts();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to confirm payment');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleMarkPayoutPaid = async (id: string) => {
    setActionBusyId(id);
    try {
      await payoutsAPI.adminMarkPaid(id);
      toast.success('Payout marked as paid.');
      await loadPaymentsAndPayouts();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to mark payout paid');
    } finally {
      setActionBusyId(null);
    }
  };

  const handleCancelPayout = async (id: string) => {
    const reason = window.prompt('Reason for cancelling this payout:');
    if (!reason || !reason.trim()) return;
    setActionBusyId(id);
    try {
      await payoutsAPI.adminCancel(id, reason.trim());
      toast.success('Payout cancelled.');
      await loadPaymentsAndPayouts();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to cancel payout');
    } finally {
      setActionBusyId(null);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, propsRes, pendingRes] = await Promise.all([
        usersAPI.adminStats(),
        propertiesAPI.getAll(),
        propertiesAPI.getPendingReview().catch(() => []),
      ]);
      setStats(statsRes);
      setProperties(propsRes);
      setPendingListings(pendingRes);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadPaymentsAndPayouts(); }, [loadPaymentsAndPayouts]);

  const handleRemoveListing = async (listingId: string, title: string) => {
    try {
      await usersAPI.deleteListing(listingId);
      toast.success(`"${title}" removed`);
      setProperties(prev => prev.filter(p => String(p.id) !== String(listingId)));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove listing');
    }
  };

  const handleApproveListing = async (listingId: string, title: string) => {
    try {
      await propertiesAPI.approveListing(listingId);
      toast.success(`"${title}" approved and now live!`);
      setPendingListings(prev => prev.filter(p => String(p.id) !== String(listingId)));
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to approve listing');
    }
  };

  const handleRejectListing = async (listingId: string, title: string) => {
    const reason = window.prompt(`Rejection reason for "${title}" (optional):`);
    if (reason === null) return; // user cancelled prompt
    try {
      await propertiesAPI.rejectListing(listingId, reason);
      toast.success(`"${title}" rejected.`);
      setPendingListings(prev => prev.filter(p => String(p.id) !== String(listingId)));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to reject listing');
    }
  };

  const filteredProperties = properties.filter(p => {
    const q = propSearch.toLowerCase();
    return !q || p.title?.toLowerCase().includes(q) || p.location?.city?.toLowerCase().includes(q);
  });

  // ── Overview ──────────────────────────────────────────────────────────────
  const renderOverview = () => (
    <div className="space-y-6">
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard label="Total Revenue"   value={formatCurrency(stats?.totals?.revenue ?? 0)} icon={DollarSign} />
          <StatCard label="Total Users"     value={stats?.totals?.users ?? 0}                   icon={Users} />
          <StatCard label="Active Listings" value={stats?.totals?.listings ?? 0}                icon={Home} />
          <StatCard label="Total Bookings"  value={stats?.totals?.bookings ?? 0}                icon={TrendingUp} />
        </div>
      )}

      {/* Bookings by status */}
      {stats?.bookings_by_status && (
        <div className="grid sm:grid-cols-4 gap-4">
          {Object.entries(stats.bookings_by_status as Record<string, number>).map(([s, count]) => (
            <Card key={s}>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground capitalize">{s}</p>
                <p className="text-xl font-semibold">{count}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Recent bookings */}
      <Card>
        <CardHeader><CardTitle>Recent Bookings</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(5)].map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                      </TableRow>
                    ))
                  : (stats?.recent_bookings ?? []).map((b: any) => (
                      <TableRow key={b.id}>
                        <TableCell>
                          <p className="font-medium">{b.customer_username}</p>
                          <p className="text-xs text-muted-foreground">{b.customer_email}</p>
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">{b.listing_title}</TableCell>
                        <TableCell className="text-sm">{b.start_date} → {b.end_date}</TableCell>
                        <TableCell>{formatCurrency(b.total_price)}</TableCell>
                        <TableCell>
                          <Badge className={statusColor[b.status] ?? ''}>{b.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ── Property Management ───────────────────────────────────────────────────
  const renderPropertyManagement = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Property Management</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search properties..."
              className="pl-10 w-full sm:w-64"
              value={propSearch}
              onChange={e => setPropSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={() => navigate('/management/listing-moderation')}>
            Inventory & Moderation
          </Button>
        </div>
      </div>

      {/* Pending review banner */}
      {pendingListings.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-yellow-50 border border-yellow-200 rounded-xl">
          <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse flex-shrink-0" />
          <p className="text-sm font-medium text-yellow-800">
            {pendingListings.length} listing{pendingListings.length > 1 ? 's' : ''} pending your review
          </p>
          <button type="button" onClick={() => setPropTab('pending')} className="ml-auto text-sm text-primary font-semibold hover:underline">
            Review now →
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setPropTab('published')}
          className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${propTab === 'published' ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary'}`}
        >
          Published ({filteredProperties.length})
        </button>
        <button
          type="button"
          onClick={() => setPropTab('pending')}
          className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${propTab === 'pending' ? 'bg-yellow-500 text-white border-yellow-500' : 'border-border text-muted-foreground hover:border-yellow-400'}`}
        >
          Pending Review ({pendingListings.length})
        </button>
      </div>

      {propTab === 'published' ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading
                    ? [...Array(5)].map((_, i) => (
                        <TableRow key={i}>
                          {[...Array(4)].map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                        </TableRow>
                      ))
                    : filteredProperties.map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              {p.images?.[0] && (
                                <img src={p.images[0]} alt={p.title} className="w-12 h-8 rounded object-cover" />
                              )}
                              <div>
                                <p className="font-medium truncate max-w-[200px]">{p.title}</p>
                                <p className="text-sm text-muted-foreground">{p.location?.city}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{p.host?.firstName} {p.host?.lastName}</TableCell>
                          <TableCell>{formatCurrency(p.price)}/{p.pricingType === 'monthly' ? 'month' : 'night'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={() => navigate(`/rooms/${p.id}`)}>
                                <Eye className="h-3 w-3 mr-1" /> View
                              </Button>
                              <Button
                                variant="outline" size="sm" className="text-red-600"
                                onClick={() => handleRemoveListing(String(p.id), p.title)}
                              >
                                <X className="h-3 w-3 mr-1" /> Remove
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                  }
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingListings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No listings pending review.
                      </TableCell>
                    </TableRow>
                  ) : pendingListings.map((p: any) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {p.images?.[0] && (
                            <img src={p.images[0]} alt={p.title} className="w-12 h-8 rounded object-cover" />
                          )}
                          <div>
                            <p className="font-medium truncate max-w-[200px]">{p.title}</p>
                            <p className="text-sm text-muted-foreground">{p.location?.city}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{p.host?.firstName} {p.host?.lastName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => navigate(`/rooms/${p.id}`)}>
                            <Eye className="h-3 w-3 mr-1" /> Preview
                          </Button>
                          <Button
                            size="sm"
                            className="bg-primary text-white"
                            onClick={() => handleApproveListing(String(p.id), p.title)}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline" size="sm" className="text-red-600 border-red-200"
                            onClick={() => handleRejectListing(String(p.id), p.title)}
                          >
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // ── Bookings ──────────────────────────────────────────────────────────────
  const renderBookings = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Recent Bookings</h2>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(7)].map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                      </TableRow>
                    ))
                  : (stats?.recent_bookings ?? []).map((b: any) => (
                      <TableRow key={b.id}>
                        <TableCell className="font-mono text-sm">#{b.id}</TableCell>
                        <TableCell>
                          <p className="font-medium">{b.customer_username}</p>
                          <p className="text-xs text-muted-foreground">{b.customer_email}</p>
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">{b.listing_title}</TableCell>
                        <TableCell className="text-sm">{b.start_date} → {b.end_date}</TableCell>
                        <TableCell>{formatCurrency(b.total_price)}</TableCell>
                        <TableCell>
                          <Badge className={statusColor[b.status] ?? ''}>{b.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <CommunicationsDialog bookingId={b.id} />
                        </TableCell>
                      </TableRow>
                    ))
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ── Payments ──────────────────────────────────────────────────────────────
  const renderPayments = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold mb-1">Payments awaiting confirmation</h2>
          <p className="text-sm text-muted-foreground">
            All guest payments land in the Home Konet account. Confirm each one to share the host's
            contact with the guest and create the host payout.
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/management/finance')}>
          Finance & Legal Center
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Property</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Total paid</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paymentReceived.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">
                      No payments awaiting confirmation.
                    </TableCell>
                  </TableRow>
                ) : (
                  paymentReceived.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">
                        {b.user?.firstName || b.userId}
                        {escrowByBooking[b.id]?.on_hold && (
                          <Badge variant="destructive" className="ml-2 text-[10px]" title={escrowByBooking[b.id].hold_reason}>on hold</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate">{b.property?.title}</TableCell>
                      <TableCell className="text-sm">{b.checkIn} → {b.checkOut}</TableCell>
                      <TableCell>{formatCurrency(b.totalPrice)}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <CommunicationsDialog bookingId={b.id} />
                        <Button size="sm" disabled={actionBusyId === b.id || escrowByBooking[b.id]?.on_hold} onClick={() => handleConfirmPayment(b.id)}>
                          {actionBusyId === b.id ? 'Confirming…' : 'Confirm payment'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <h2 className="text-2xl font-semibold">Recent Payments</h2>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(6)].map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                      </TableRow>
                    ))
                  : (stats?.recent_payments ?? []).map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-sm">{p.id.slice(0, 8)}…</TableCell>
                        <TableCell>{p.user}</TableCell>
                        <TableCell><Badge variant="outline">{p.gateway || 'mtn_momo'}</Badge></TableCell>
                        <TableCell className="text-green-600">+{formatCurrency(p.amount)}</TableCell>
                        <TableCell>
                          <Badge className={paymentStatusColor[p.status] ?? ''}>{p.status}</Badge>
                        </TableCell>
                        <TableCell className="text-sm">{new Date(p.created_at).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  // ── Host Payouts ──────────────────────────────────────────────────────────
  const renderPayouts = () => {
    const filtered = payouts.filter((p) => p.status === payoutTab);
    const pendingTotal = payouts
      .filter((p) => p.status === 'pending')
      .reduce((sum, p) => sum + p.netAmount, 0);
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-semibold mb-1">Host Payouts</h2>
          <p className="text-sm text-muted-foreground">
            Amounts owed to hosts after the 4% commission. Mark a payout as paid once you've
            disbursed it from the Home Konet account.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <StatCard label="Pending payouts" value={payouts.filter((p) => p.status === 'pending').length} icon={DollarSign} />
          <StatCard label="Total owed" value={formatCurrency(pendingTotal)} icon={TrendingUp} sub="Net of commission" />
        </div>

        <div className="flex gap-2">
          {(['pending', 'paid', 'cancelled'] as const).map((tab) => (
            <Button key={tab} variant={payoutTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setPayoutTab(tab)}>
              {tab === 'pending' ? 'Pending' : tab === 'paid' ? 'Paid' : 'Cancelled'}
            </Button>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Host</TableHead>
                    <TableHead>Property</TableHead>
                    <TableHead>Gross</TableHead>
                    <TableHead>Commission</TableHead>
                    <TableHead>Net payout</TableHead>
                    {payoutTab === 'pending' ? <TableHead className="text-right">Action</TableHead> : payoutTab === 'paid' ? <TableHead>Paid on</TableHead> : <TableHead>Reason</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                        No {payoutTab} payouts.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.hostName || '—'}
                          <span className="block text-xs text-muted-foreground">Booking #{p.bookingId}</span>
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate">{p.listingTitle}</TableCell>
                        <TableCell>{formatCurrency(p.grossAmount)}</TableCell>
                        <TableCell className="text-muted-foreground">-{formatCurrency(p.serviceFeeAmount)}</TableCell>
                        <TableCell className="font-semibold">{formatCurrency(p.netAmount)}</TableCell>
                        {payoutTab === 'pending' ? (
                          <TableCell className="text-right space-x-2">
                            <Button size="sm" disabled={actionBusyId === p.id} onClick={() => handleMarkPayoutPaid(p.id)}>
                              {actionBusyId === p.id ? 'Saving…' : 'Mark paid'}
                            </Button>
                            <Button size="sm" variant="outline" className="text-destructive" disabled={actionBusyId === p.id} onClick={() => handleCancelPayout(p.id)}>
                              Cancel
                            </Button>
                          </TableCell>
                        ) : payoutTab === 'paid' ? (
                          <TableCell className="text-sm">{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}</TableCell>
                        ) : (
                          <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={p.cancellationReason}>{p.cancellationReason || '—'}</TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ── Trust & Safety ───────────────────────────────────────────────────────
  const renderTrustSafety = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Trust & Safety</h2>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>KYC & Verification Review</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Host identity applications and property-ownership verifications awaiting manual review.
            </p>
            <Button onClick={() => navigate('/management/kyc-queue')}>
              Open Review Queue
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Fraud & AML</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Rule-based fraud flags (rapid signups, shared cards), plus device fingerprint and
              location banning.
            </p>
            <Button onClick={() => navigate('/management/fraud-flags')}>
              Open Fraud & AML
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // ── Security ──────────────────────────────────────────────────────────────
  const renderSecurity = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Security</h2>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Active Suspensions</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/management/suspensions')}>
              Open Suspensions Center
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Reports Queue</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/management/reports')}>
              Open Reports Center
            </Button>
          </CardContent>
        </Card>
        {currentAdmin?.isAdmin && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ScrollText className="h-4 w-4" /> Audit Log</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">Every sensitive action taken from this dashboard — who, what, when, and why.</p>
              <Button onClick={() => navigate('/management/audit-log')}>
                Open Audit Log
              </Button>
            </CardContent>
          </Card>
        )}
        <MfaSetupCard />
      </div>
    </div>
  );

  // ── Settings ──────────────────────────────────────────────────────────────
  const renderSettings = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Platform Settings</h2>
        <Button variant="outline" onClick={() => navigate('/management/platform-ops')}>
          Platform & Engineering
        </Button>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Fees</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {platformFeeLoading || !platformFee ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium">Booking fee (USD, flat)</label>
                  <Input
                    type="number" step="0.01" className="w-32 mt-1"
                    value={platformFeeDraft.booking_fee ?? ''}
                    onChange={(e) => setPlatformFeeDraft((d) => ({ ...d, booking_fee: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Viewing fee (USD, flat)</label>
                  <Input
                    type="number" step="0.01" className="w-32 mt-1"
                    value={platformFeeDraft.viewing_fee ?? ''}
                    onChange={(e) => setPlatformFeeDraft((d) => ({ ...d, viewing_fee: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Service fee (%, applied to both guest and host sides)</label>
                  <Input
                    type="number" step="0.01" className="w-32 mt-1"
                    value={platformFeeDraft.service_fee_percent ?? ''}
                    onChange={(e) => setPlatformFeeDraft((d) => ({ ...d, service_fee_percent: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Transaction fee type</label>
                  <Select
                    value={platformFeeDraft.transaction_fee_type}
                    onValueChange={(v) => setPlatformFeeDraft((d) => ({ ...d, transaction_fee_type: v as PlatformFee['transaction_fee_type'] }))}
                  >
                    <SelectTrigger className="mt-1 w-48">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixed amount (USD)</SelectItem>
                      <SelectItem value="percentage">Percentage</SelectItem>
                      <SelectItem value="range">Range (min–max USD)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">
                    Transaction fee value {platformFeeDraft.transaction_fee_type === 'percentage' ? '(%)' : '(USD)'}
                  </label>
                  <Input
                    type="number" step="0.0001" className="w-32 mt-1"
                    value={platformFeeDraft.transaction_fee_value ?? ''}
                    onChange={(e) => setPlatformFeeDraft((d) => ({ ...d, transaction_fee_value: e.target.value }))}
                  />
                </div>
                {platformFeeDraft.transaction_fee_type === 'range' && (
                  <div className="flex gap-4">
                    <div>
                      <label className="text-sm font-medium">Min (USD)</label>
                      <Input
                        type="number" step="0.01" className="w-28 mt-1"
                        value={platformFeeDraft.transaction_fee_min ?? ''}
                        onChange={(e) => setPlatformFeeDraft((d) => ({ ...d, transaction_fee_min: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Max (USD)</label>
                      <Input
                        type="number" step="0.01" className="w-28 mt-1"
                        value={platformFeeDraft.transaction_fee_max ?? ''}
                        onChange={(e) => setPlatformFeeDraft((d) => ({ ...d, transaction_fee_max: e.target.value }))}
                      />
                    </div>
                  </div>
                )}
                <Button disabled={platformFeeSaving} onClick={handleSavePlatformFee}>
                  {platformFeeSaving ? 'Saving…' : 'Save changes'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Takes effect immediately — no deployment needed.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const loadSupport = useCallback(async () => {
    setSupportLoading(true);
    try {
      const [ticketsRes, statsRes, contactRes] = await Promise.all([
        supportAPI.adminGetTickets(ticketFilter ? { status: ticketFilter } : undefined),
        supportAPI.adminGetStats(),
        supportAPI.adminGetContacts(),
      ]);
      setSupportTickets(ticketsRes.results);
      setSupportStats(statsRes);
      setContactInquiries(contactRes);
    } catch {
      toast.error('Failed to load support data');
    } finally {
      setSupportLoading(false);
    }
  }, [ticketFilter]);

  useEffect(() => {
    if (activeSection === 'support') loadSupport();
  }, [activeSection, loadSupport]);

  const loadPlatformFee = useCallback(async () => {
    setPlatformFeeLoading(true);
    try {
      const fee = await paymentAPI.adminGetPlatformFee();
      setPlatformFee(fee);
      setPlatformFeeDraft(fee);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load platform fee settings');
    } finally {
      setPlatformFeeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === 'settings') loadPlatformFee();
  }, [activeSection, loadPlatformFee]);

  const handleSavePlatformFee = async () => {
    setPlatformFeeSaving(true);
    try {
      const updated = await paymentAPI.adminUpdatePlatformFee(platformFeeDraft);
      setPlatformFee(updated);
      setPlatformFeeDraft(updated);
      toast.success('Platform fees updated.');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save platform fees');
    } finally {
      setPlatformFeeSaving(false);
    }
  };

  const ticketStatusColor: Record<string, string> = {
    open:         'bg-blue-100 text-blue-700',
    in_progress:  'bg-yellow-100 text-yellow-700',
    pending_user: 'bg-orange-100 text-orange-700',
    resolved:     'bg-green-100 text-green-700',
    closed:       'bg-gray-100 text-gray-600',
  };
  const priorityColor: Record<string, string> = {
    low: 'bg-slate-100 text-slate-600',
    medium: 'bg-blue-100 text-blue-600',
    high: 'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700',
  };

  const handleUpdateTicket = async (id: number, payload: Record<string, any>) => {
    try {
      const updated = await supportAPI.adminUpdateTicket(id, payload);
      setSupportTickets(prev => prev.map(t => t.id === id ? updated : t));
      setTicketDetails(prev => prev[id] ? { ...prev, [id]: { ...prev[id], ...updated } } : prev);
      toast.success('Ticket updated');
    } catch {
      toast.error('Failed to update ticket');
    }
  };

  const loadTicketDetail = async (id: number) => {
    setTicketDetailLoading(id);
    try {
      const detail = await supportAPI.getTicket(id);
      setTicketDetails(prev => ({ ...prev, [id]: detail }));
    } catch {
      toast.error('Failed to load ticket conversation');
    } finally {
      setTicketDetailLoading(null);
    }
  };

  const toggleTicket = (id: number) => {
    if (expandedTicket === id) {
      setExpandedTicket(null);
      return;
    }
    setExpandedTicket(id);
    if (!ticketDetails[id]) loadTicketDetail(id);
  };

  const handleSendReply = async (id: number) => {
    const content = (replyDraft[id] || '').trim();
    if (!content) return;
    try {
      await supportAPI.addMessage(id, content);
      setReplyDraft(prev => ({ ...prev, [id]: '' }));
      await loadTicketDetail(id);
      await loadSupport();
    } catch {
      toast.error('Failed to send reply');
    }
  };

  const handleEscalateTicket = async (id: number) => {
    try {
      const updated = await supportAPI.adminEscalateTicket(id, escalateDraft[id] || '');
      setSupportTickets(prev => prev.map(t => t.id === id ? updated : t));
      setTicketDetails(prev => ({ ...prev, [id]: updated }));
      toast.success('Ticket escalated to urgent priority.');
    } catch {
      toast.error('Failed to escalate ticket');
    }
  };

  const handleMarkContactRead = async (id: number) => {
    try {
      await supportAPI.adminMarkContactRead(id);
      setContactInquiries(prev => prev.map(c => c.id === id ? { ...c, isRead: true } : c));
    } catch {
      toast.error('Failed to mark as read');
    }
  };

  const renderSupport = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold">Support Center</h2>
        <Button variant="outline" size="sm" onClick={loadSupport} className="w-fit">
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Stats row */}
      {supportStats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {[
            { label: 'Open',           value: supportStats.open,         color: 'text-blue-600' },
            { label: 'In Progress',    value: supportStats.in_progress,  color: 'text-yellow-600' },
            { label: 'Pending User',   value: supportStats.pending_user, color: 'text-orange-600' },
            { label: 'Resolved',       value: supportStats.resolved,     color: 'text-green-600' },
            { label: 'Closed',         value: supportStats.closed,       color: 'text-gray-500' },
            { label: 'SLA Breached',   value: supportStats.breached,     color: 'text-destructive' },
            { label: 'Unread Contact', value: supportStats.unread_contact, color: 'text-destructive' },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border pb-0">
        {(['tickets', 'contact'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setSupportTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
              supportTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'tickets' ? 'Support Tickets' : 'Contact Inquiries'}
            {tab === 'contact' && supportStats?.unread_contact > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-destructive text-white rounded-full">{supportStats.unread_contact}</span>
            )}
          </button>
        ))}
      </div>

      {supportTab === 'tickets' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            {['', 'open', 'in_progress', 'pending_user', 'resolved', 'closed'].map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setTicketFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  ticketFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-primary'
                }`}
              >
                {s === '' ? 'All' : s.replace('_', ' ')}
              </button>
            ))}
          </div>

          {supportLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : supportTickets.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">No tickets found.</div>
          ) : (
            <div className="space-y-3">
              {supportTickets.map(ticket => (
                <Card key={ticket.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    {/* Ticket header row */}
                    <button
                      type="button"
                      className="w-full flex items-start justify-between gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
                      onClick={() => toggleTicket(ticket.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
                          <Badge className={ticketStatusColor[ticket.status] ?? ''}>{ticket.status.replace('_', ' ')}</Badge>
                          <Badge className={priorityColor[ticket.priority] ?? ''}>{ticket.priority}</Badge>
                          {ticket.isBreached && <Badge variant="destructive">SLA breached</Badge>}
                          {ticket.escalatedAt && <Badge className="bg-red-100 text-red-700">Escalated</Badge>}
                          <span className="text-xs text-muted-foreground capitalize">{ticket.category.replace('_', ' ')}</span>
                        </div>
                        <p className="font-medium text-sm truncate">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {ticket.requesterName} · {ticket.requesterEmail} · {new Date(ticket.createdAt).toLocaleDateString()}
                          {ticket.assignedToName && <span className="ml-2 text-primary">Assigned: {ticket.assignedToName}</span>}
                          {ticket.slaDueAt && !ticket.isBreached && <span className="ml-2">SLA due: {new Date(ticket.slaDueAt).toLocaleString()}</span>}
                        </p>
                      </div>
                      {expandedTicket === ticket.id ? <ChevronUp className="w-4 h-4 shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 shrink-0 mt-1" />}
                    </button>

                    {/* Expanded panel */}
                    {expandedTicket === ticket.id && (
                      <div className="border-t border-border p-4 space-y-4">
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{ticket.description}</p>

                        {/* Admin controls */}
                        <div className="flex flex-wrap gap-3 items-end">
                          {/* Status */}
                          <div className="space-y-1">
                            <label htmlFor={`status-${ticket.id}`} className="text-xs font-medium text-muted-foreground">Status</label>
                            <select
                              id={`status-${ticket.id}`}
                              title="Ticket status"
                              className="text-sm border border-border rounded-lg px-2 py-1.5 bg-background"
                              value={ticket.status}
                              onChange={e => handleUpdateTicket(ticket.id, { status: e.target.value })}
                            >
                              {['open', 'in_progress', 'pending_user', 'resolved', 'closed'].map(s => (
                                <option key={s} value={s}>{s.replace('_', ' ')}</option>
                              ))}
                            </select>
                          </div>
                          {/* Priority */}
                          <div className="space-y-1">
                            <label htmlFor={`priority-${ticket.id}`} className="text-xs font-medium text-muted-foreground">Priority</label>
                            <select
                              id={`priority-${ticket.id}`}
                              title="Ticket priority"
                              className="text-sm border border-border rounded-lg px-2 py-1.5 bg-background"
                              value={ticket.priority}
                              onChange={e => handleUpdateTicket(ticket.id, { priority: e.target.value })}
                            >
                              {['low', 'medium', 'high', 'urgent'].map(p => (
                                <option key={p} value={p}>{p}</option>
                              ))}
                            </select>
                          </div>
                          {/* Assign */}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Assign to (user ID)</label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                placeholder="User ID"
                                className="w-24 h-9 text-sm"
                                value={assignInput}
                                onChange={e => setAssignInput(e.target.value)}
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (assignInput) {
                                    handleUpdateTicket(ticket.id, { assigned_to: Number(assignInput) });
                                    setAssignInput('');
                                  }
                                }}
                              >
                                <UserCheck className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                          {/* Escalate */}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Escalate</label>
                            <div className="flex gap-2">
                              <Input
                                placeholder="Escalation notes"
                                className="w-48 h-9 text-sm"
                                value={escalateDraft[ticket.id] || ''}
                                onChange={e => setEscalateDraft(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                              />
                              <Button size="sm" variant="destructive" onClick={() => handleEscalateTicket(ticket.id)}>
                                Escalate
                              </Button>
                            </div>
                          </div>
                        </div>

                        {(() => {
                          const detail = ticketDetails[ticket.id];
                          const attachments = detail?.attachments || ticket.attachments;
                          return (
                            <>
                              {/* Attachments */}
                              {attachments && attachments.length > 0 && (
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-2">Attachments</p>
                                  <div className="flex flex-wrap gap-2">
                                    {attachments.map(a => (
                                      <a
                                        key={a.id}
                                        href={a.fileUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors"
                                      >
                                        📎 {a.filename}
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Conversation */}
                              <div className="space-y-3 border-t border-border pt-4">
                                <p className="text-xs font-medium text-muted-foreground">Conversation</p>
                                {ticketDetailLoading === ticket.id ? (
                                  <Skeleton className="h-16 rounded-lg" />
                                ) : (
                                  <div className="space-y-2 max-h-64 overflow-y-auto">
                                    {(detail?.messages || []).map(m => (
                                      <div
                                        key={m.id}
                                        className={`p-2.5 rounded-lg text-sm max-w-[85%] ${m.isStaffReply ? 'bg-primary/10 ml-auto' : 'bg-muted'}`}
                                      >
                                        <p className="text-xs font-medium text-muted-foreground mb-0.5">
                                          {m.senderName} · {new Date(m.createdAt).toLocaleString()}
                                        </p>
                                        <p className="whitespace-pre-wrap">{m.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex gap-2">
                                  <Textarea
                                    placeholder="Reply to this ticket…"
                                    className="flex-1"
                                    rows={2}
                                    value={replyDraft[ticket.id] || ''}
                                    onChange={e => setReplyDraft(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                                  />
                                  <Button size="sm" onClick={() => handleSendReply(ticket.id)}>Send</Button>
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {supportTab === 'contact' && (
        <div className="space-y-3">
          {supportLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : contactInquiries.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">No contact inquiries.</div>
          ) : (
            contactInquiries.map(c => (
              <Card key={c.id} className={c.isRead ? 'opacity-70' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {!c.isRead && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                        <span className="font-medium text-sm">{c.subject}</span>
                        <Badge variant="outline" className="text-xs capitalize">{c.category.replace('_', ' ')}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">{c.name} · <a href={`mailto:${c.email}`} className="hover:underline">{c.email}</a> · {new Date(c.createdAt).toLocaleDateString()}</p>
                      <p className="text-sm text-muted-foreground line-clamp-3">{c.message}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" asChild>
                        <a href={`mailto:${c.email}?subject=Re: ${encodeURIComponent(c.subject)}`}>
                          <Mail className="w-3.5 h-3.5 mr-1" /> Reply
                        </a>
                      </Button>
                      {!c.isRead && (
                        <Button size="sm" variant="ghost" onClick={() => handleMarkContactRead(c.id)}>
                          <CheckCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':   return renderOverview();
      case 'properties': return renderPropertyManagement();
      case 'bookings':   return renderBookings();
      case 'payments':   return renderPayments();
      case 'payouts':    return renderPayouts();
      case 'support':    return renderSupport();
      case 'trust_safety': return renderTrustSafety();
      case 'security':   return renderSecurity();
      case 'settings':   return renderSettings();
      default:           return renderOverview();
    }
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Admin Dashboard</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navGroups.map((group) => {
                    const isGroupActive = group.items.some((item) => item.type === 'section' && item.id === activeSection);
                    return (
                      <Collapsible key={group.id} open={expandedGroups.has(group.id)} onOpenChange={() => toggleGroup(group.id)}>
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton isActive={isGroupActive}>
                              <group.icon className="h-4 w-4" />
                              <span>{group.label}</span>
                              {expandedGroups.has(group.id)
                                ? <ChevronDown className="h-3.5 w-3.5 ml-auto" />
                                : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {group.items.map((item) => (
                                <SidebarMenuSubItem key={item.type === 'section' ? item.id : item.path}>
                                  <SidebarMenuSubButton
                                    isActive={item.type === 'section' && activeSection === item.id}
                                    onClick={() => item.type === 'section' ? setActiveSection(item.id) : navigate(item.path)}
                                  >
                                    <span>{item.label}</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <main className="flex-1 overflow-auto">
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <SidebarTrigger />
              <h1 className="text-2xl font-semibold">
                {sectionLabels[activeSection] || 'Overview'}
              </h1>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>
            {renderContent()}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
