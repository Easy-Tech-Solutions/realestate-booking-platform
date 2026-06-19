import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Ban, Building2, CheckCircle, DollarSign, Home, TrendingUp, Users,
  Search, Eye, X, Shield, Settings, BarChart3, Calendar,
  CreditCard, RefreshCw, Headphones, Mail, ChevronDown, ChevronUp, UserCheck,
} from 'lucide-react';
import { supportAPI, SupportTicket, ContactInquiry } from '../../services/api/support';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Skeleton } from '../components/ui/skeleton';
import { formatCurrency } from '../../core/utils';
import { toast } from 'sonner';
import { usersAPI, propertiesAPI, bookingsAPI, payoutsAPI } from '../../services/api';
import type { Booking, Payout } from '../../core/types';
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger,
} from '../components/ui/sidebar';

const menuItems = [
  { id: 'overview',    label: 'Overview',            icon: BarChart3 },
  { id: 'users',       label: 'User Management',     icon: Users },
  { id: 'properties',  label: 'Property Management', icon: Building2 },
  { id: 'bookings',    label: 'Bookings',             icon: Calendar },
  { id: 'payments',    label: 'Payments',             icon: CreditCard },
  { id: 'payouts',     label: 'Host Payouts',         icon: DollarSign },
  { id: 'support',     label: 'Support Tickets',      icon: Headphones },
  { id: 'security',    label: 'Security',             icon: Shield },
  { id: 'settings',    label: 'Settings',             icon: Settings },
];

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
  const [activeSection, setActiveSection] = useState('overview');

  // Data state
  const [stats, setStats]           = useState<any>(null);
  const [users, setUsers]           = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [userSearch, setUserSearch] = useState('');
  const [propSearch, setPropSearch] = useState('');
  const [pendingListings, setPendingListings] = useState<any[]>([]);
  const [propTab, setPropTab] = useState<'published' | 'pending'>('published');

  // Support state
  const [supportTickets, setSupportTickets]     = useState<SupportTicket[]>([]);
  const [supportStats, setSupportStats]         = useState<any>(null);
  const [contactInquiries, setContactInquiries] = useState<ContactInquiry[]>([]);
  const [supportLoading, setSupportLoading]     = useState(false);
  const [ticketFilter, setTicketFilter]         = useState('');
  const [expandedTicket, setExpandedTicket]     = useState<number | null>(null);
  const [assignInput, setAssignInput]           = useState('');
  const [supportTab, setSupportTab]             = useState<'tickets' | 'contact'>('tickets');

  // Payments awaiting confirmation + host payouts
  const [paymentReceived, setPaymentReceived] = useState<Booking[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [payoutTab, setPayoutTab] = useState<'pending' | 'paid'>('pending');
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);

  const loadPaymentsAndPayouts = useCallback(async () => {
    const [pr, po] = await Promise.all([
      bookingsAPI.getPaymentReceived().catch(() => [] as Booking[]),
      payoutsAPI.adminList().catch(() => [] as Payout[]),
    ]);
    setPaymentReceived(pr);
    setPayouts(po);
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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, propsRes, pendingRes] = await Promise.all([
        usersAPI.adminStats(),
        usersAPI.listAll(),
        propertiesAPI.getAll(),
        propertiesAPI.getPendingReview().catch(() => []),
      ]);
      setStats(statsRes);
      setUsers(usersRes);
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

  const handleSuspendUser = async (userId: string, username: string) => {
    try {
      await usersAPI.suspendUser(userId, {
        suspension_type: 'indefinite',
        reason: 'Suspended by admin',
        ends_at: null,
      });
      toast.success(`${username} suspended`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to suspend user');
    }
  };

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

  const filteredUsers = users.filter(u => {
    const q = userSearch.toLowerCase();
    return !q || u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) ||
      u.first_name?.toLowerCase().includes(q) || u.last_name?.toLowerCase().includes(q);
  });

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

  // ── User Management ───────────────────────────────────────────────────────
  const renderUserManagement = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">User Management</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search users..."
            className="pl-10 w-full sm:w-64"
            value={userSearch}
            onChange={e => setUserSearch(e.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(5)].map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
                      </TableRow>
                    ))
                  : filteredUsers.map((user: any) => (
                      <TableRow key={user.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarImage src={user.profile?.image} />
                              <AvatarFallback>{user.first_name?.[0]}{user.last_name?.[0]}</AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-medium">{user.first_name} {user.last_name}</p>
                              <p className="text-sm text-muted-foreground">{user.email || user.username}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.role === 'agent' ? 'default' : 'secondary'}>
                            {user.role ?? 'guest'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {user.email_verified && <CheckCircle className="h-4 w-4 text-green-500" />}
                            <span className="text-sm">{user.email_verified ? 'Verified' : 'Unverified'}</span>
                          </div>
                        </TableCell>
                        <TableCell>{new Date(user.member_since).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => navigate(`/users/${user.id}`)}>
                              <Eye className="h-3 w-3 mr-1" /> View
                            </Button>
                            <Button
                              variant="outline" size="sm" className="text-orange-600"
                              onClick={() => handleSuspendUser(String(user.id), user.username)}
                            >
                              <Ban className="h-3 w-3 mr-1" /> Suspend
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
    </div>
  );

  // ── Property Management ───────────────────────────────────────────────────
  const renderPropertyManagement = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Property Management</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search properties..."
            className="pl-10 w-full sm:w-64"
            value={propSearch}
            onChange={e => setPropSearch(e.target.value)}
          />
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
                          <TableCell>{formatCurrency(p.price)}/night</TableCell>
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? [...Array(5)].map((_, i) => (
                      <TableRow key={i}>
                        {[...Array(6)].map((__, j) => <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>)}
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
      <div>
        <h2 className="text-2xl font-semibold mb-1">Payments awaiting confirmation</h2>
        <p className="text-sm text-muted-foreground">
          All guest payments land in the Home Konet account. Confirm each one to share the host's
          contact with the guest and create the host payout.
        </p>
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
                      <TableCell className="font-medium">{b.user?.firstName || b.userId}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{b.property?.title}</TableCell>
                      <TableCell className="text-sm">{b.checkIn} → {b.checkOut}</TableCell>
                      <TableCell>{formatCurrency(b.totalPrice)}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" disabled={actionBusyId === b.id} onClick={() => handleConfirmPayment(b.id)}>
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
          {(['pending', 'paid'] as const).map((tab) => (
            <Button key={tab} variant={payoutTab === tab ? 'default' : 'outline'} size="sm" onClick={() => setPayoutTab(tab)}>
              {tab === 'pending' ? 'Pending' : 'Paid'}
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
                    {payoutTab === 'pending' ? <TableHead className="text-right">Action</TableHead> : <TableHead>Paid on</TableHead>}
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
                          <TableCell className="text-right">
                            <Button size="sm" disabled={actionBusyId === p.id} onClick={() => handleMarkPayoutPaid(p.id)}>
                              {actionBusyId === p.id ? 'Saving…' : 'Mark paid'}
                            </Button>
                          </TableCell>
                        ) : (
                          <TableCell className="text-sm">{p.paidAt ? new Date(p.paidAt).toLocaleDateString() : '—'}</TableCell>
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

  // ── Security ──────────────────────────────────────────────────────────────
  const renderSecurity = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Security</h2>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Active Suspensions</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/admin/suspensions')}>
              Open Suspensions Center
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Reports Queue</CardTitle></CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/admin/reports')}>
              Open Reports Center
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // ── Settings ──────────────────────────────────────────────────────────────
  const renderSettings = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Platform Settings</h2>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Fees & Policies</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Service Fee (%)</label>
              <div className="flex items-center gap-2 mt-1">
                <Input type="number" defaultValue="14" className="w-20" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Tax Rate (%)</label>
              <div className="flex items-center gap-2 mt-1">
                <Input type="number" defaultValue="5" className="w-20" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Default Cancellation Policy</label>
              <Select>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select policy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flexible">Flexible</SelectItem>
                  <SelectItem value="moderate">Moderate</SelectItem>
                  <SelectItem value="strict">Strict</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Fee changes require a backend deployment to take effect.
            </p>
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
      toast.success('Ticket updated');
    } catch {
      toast.error('Failed to update ticket');
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Open',           value: supportStats.open,         color: 'text-blue-600' },
            { label: 'In Progress',    value: supportStats.in_progress,  color: 'text-yellow-600' },
            { label: 'Pending User',   value: supportStats.pending_user, color: 'text-orange-600' },
            { label: 'Resolved',       value: supportStats.resolved,     color: 'text-green-600' },
            { label: 'Closed',         value: supportStats.closed,       color: 'text-gray-500' },
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
                      onClick={() => setExpandedTicket(expandedTicket === ticket.id ? null : ticket.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
                          <Badge className={ticketStatusColor[ticket.status] ?? ''}>{ticket.status.replace('_', ' ')}</Badge>
                          <Badge className={priorityColor[ticket.priority] ?? ''}>{ticket.priority}</Badge>
                          <span className="text-xs text-muted-foreground capitalize">{ticket.category.replace('_', ' ')}</span>
                        </div>
                        <p className="font-medium text-sm truncate">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {ticket.requesterName} · {ticket.requesterEmail} · {new Date(ticket.createdAt).toLocaleDateString()}
                          {ticket.assignedToName && <span className="ml-2 text-primary">Assigned: {ticket.assignedToName}</span>}
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
                        </div>

                        {/* Attachments */}
                        {ticket.attachments && ticket.attachments.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground mb-2">Attachments</p>
                            <div className="flex flex-wrap gap-2">
                              {ticket.attachments.map(a => (
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
      case 'users':      return renderUserManagement();
      case 'properties': return renderPropertyManagement();
      case 'bookings':   return renderBookings();
      case 'payments':   return renderPayments();
      case 'payouts':    return renderPayouts();
      case 'support':    return renderSupport();
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
                  {menuItems.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        onClick={() => setActiveSection(item.id)}
                        isActive={activeSection === item.id}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
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
                {menuItems.find(item => item.id === activeSection)?.label}
              </h1>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button variant="outline" onClick={() => navigate('/admin/reports')}>Reports Center</Button>
                <Button variant="outline" onClick={() => navigate('/admin/suspensions')}>Suspensions Center</Button>
              </div>
            </div>
            {renderContent()}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
