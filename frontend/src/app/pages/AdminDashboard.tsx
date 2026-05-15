import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Ban, Building2, CheckCircle, DollarSign, Home, TrendingUp, Users,
  Search, Eye, X, Shield, Settings, BarChart3, Calendar,
  CreditCard, RefreshCw,
} from 'lucide-react';
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
import { usersAPI, propertiesAPI } from '../../services/api';
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

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, usersRes, propsRes] = await Promise.all([
        usersAPI.adminStats(),
        usersAPI.listAll(),
        propertiesAPI.getAll(),
      ]);
      setStats(statsRes);
      setUsers(usersRes);
      setProperties(propsRes);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

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

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':   return renderOverview();
      case 'users':      return renderUserManagement();
      case 'properties': return renderPropertyManagement();
      case 'bookings':   return renderBookings();
      case 'payments':   return renderPayments();
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
