import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Ban,
  Building2,
  CheckCircle,
  DollarSign,
  Home,
  TrendingUp,
  Users,
  Search,
  Eye,
  X,
  Flag,
  Shield,
  Settings,
  BarChart3,
  Calendar,
  MessageSquare,
  Mail,
  CreditCard,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { formatCurrency } from '../../core/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from 'recharts';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '../components/ui/sidebar';

const adminUsers = [
  {
    id: '1',
    email: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&h=120&fit=crop',
    isHost: true,
    verified: true,
    createdAt: '2023-01-12T00:00:00Z',
  },
  {
    id: '2',
    email: 'sarah.smith@example.com',
    firstName: 'Sarah',
    lastName: 'Smith',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=120&h=120&fit=crop',
    isHost: true,
    verified: true,
    createdAt: '2022-10-08T00:00:00Z',
  },
  {
    id: '3',
    email: 'mike.johnson@example.com',
    firstName: 'Mike',
    lastName: 'Johnson',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=120&h=120&fit=crop',
    isHost: false,
    verified: false,
    createdAt: '2024-02-19T00:00:00Z',
  },
];

const adminProperties = [
  {
    id: '1',
    title: 'Luxurious Beachfront Villa',
    images: ['https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=1000&h=700&fit=crop'],
    location: { city: 'Kigali' },
    host: { firstName: 'John', lastName: 'Doe' },
    price: 495,
  },
  {
    id: '2',
    title: 'Modern Apartment Downtown',
    images: ['https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=1000&h=700&fit=crop'],
    location: { city: 'Nairobi' },
    host: { firstName: 'Sarah', lastName: 'Smith' },
    price: 185,
  },
  {
    id: '3',
    title: 'Cozy Forest Cabin',
    images: ['https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1000&h=700&fit=crop'],
    location: { city: 'Musanze' },
    host: { firstName: 'Liam', lastName: 'Ncube' },
    price: 260,
  },
  {
    id: '4',
    title: 'Urban Loft with City View',
    images: ['https://images.unsplash.com/photo-1494526585095-c41746248156?w=1000&h=700&fit=crop'],
    location: { city: 'Kampala' },
    host: { firstName: 'Amina', lastName: 'Okello' },
    price: 210,
  },
  {
    id: '5',
    title: 'Lakefront Family Retreat',
    images: ['https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=1000&h=700&fit=crop'],
    location: { city: 'Entebbe' },
    host: { firstName: 'Grace', lastName: 'Irene' },
    price: 430,
  },
];

const adminReviews = [
  {
    id: 'R1',
    user: {
      firstName: 'Noah',
      lastName: 'Kimani',
      avatar: 'https://images.unsplash.com/photo-1521119989659-a83eee488004?w=100&h=100&fit=crop',
    },
    rating: 5,
    comment: 'Absolutely amazing stay with top-tier hospitality.',
    createdAt: '2024-05-14T00:00:00Z',
    propertyId: '1',
  },
  {
    id: 'R2',
    user: {
      firstName: 'Sophia',
      lastName: 'Nyongesa',
      avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop',
    },
    rating: 4,
    comment: 'Great place and smooth communication, would book again.',
    createdAt: '2024-05-08T00:00:00Z',
    propertyId: '2',
  },
  {
    id: 'R3',
    user: {
      firstName: 'Daniel',
      lastName: 'Moyo',
      avatar: 'https://images.unsplash.com/photo-1552058544-f2b08422138a?w=100&h=100&fit=crop',
    },
    rating: 3,
    comment: 'Nice location, but check-in instructions could be clearer.',
    createdAt: '2024-04-28T00:00:00Z',
    propertyId: '5',
  },
];

// Mock data for additional sections
const mockBookings = [
  {
    id: 'BK001',
    guest: { name: 'Mike Johnson', email: 'mike@example.com', avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop' },
    property: adminProperties[0].title,
    checkIn: '2024-05-10',
    checkOut: '2024-05-15',
    total: 2475,
    status: 'confirmed',
    paymentStatus: 'paid',
    createdAt: '2024-04-15',
  },
  {
    id: 'BK002',
    guest: { name: 'Emma Wilson', email: 'emma@example.com', avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=100&h=100&fit=crop' },
    property: adminProperties[1].title,
    checkIn: '2024-06-03',
    checkOut: '2024-06-07',
    total: 925,
    status: 'pending',
    paymentStatus: 'pending',
    createdAt: '2024-05-20',
  },
  {
    id: 'BK003',
    guest: { name: 'Alex Brown', email: 'alex@example.com', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop' },
    property: adminProperties[2].title,
    checkIn: '2024-04-20',
    checkOut: '2024-04-23',
    total: 780,
    status: 'completed',
    paymentStatus: 'paid',
    createdAt: '2024-03-10',
  },
  {
    id: 'BK004',
    guest: { name: 'Lisa Chen', email: 'lisa@example.com', avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop' },
    property: adminProperties[4].title,
    checkIn: '2024-03-15',
    checkOut: '2024-03-22',
    total: 3010,
    status: 'cancelled',
    paymentStatus: 'refunded',
    createdAt: '2024-02-28',
  },
];

const mockPayments = [
  { id: 'TXN001', user: 'Mike Johnson', amount: 2475, type: 'booking', status: 'completed', date: '2024-05-10' },
  { id: 'TXN002', user: 'Emma Wilson', amount: 925, type: 'booking', status: 'pending', date: '2024-06-03' },
  { id: 'TXN003', user: 'Alex Brown', amount: 780, type: 'booking', status: 'completed', date: '2024-04-20' },
  { id: 'TXN004', user: 'Lisa Chen', amount: 3010, type: 'refund', status: 'completed', date: '2024-03-22' },
  { id: 'TXN005', user: 'John Doe', amount: 50, type: 'commission', status: 'completed', date: '2024-05-15' },
];

const mockSecurityLogs = [
  { id: 'LOG001', user: 'Mike Johnson', action: 'login', ip: '192.168.1.1', location: 'New York, US', timestamp: '2024-05-10 14:30', suspicious: false },
  { id: 'LOG002', user: 'Emma Wilson', action: 'password_change', ip: '192.168.1.2', location: 'Los Angeles, US', timestamp: '2024-05-09 09:15', suspicious: false },
  { id: 'LOG003', user: 'Unknown', action: 'failed_login', ip: '10.0.0.1', location: 'Unknown', timestamp: '2024-05-08 22:45', suspicious: true },
  { id: 'LOG004', user: 'Alex Brown', action: '2fa_enabled', ip: '192.168.1.3', location: 'Chicago, US', timestamp: '2024-05-07 16:20', suspicious: false },
];

const revenueData = [
  { month: 'Jan', revenue: 42000, bookings: 45 },
  { month: 'Feb', revenue: 38000, bookings: 42 },
  { month: 'Mar', revenue: 51000, bookings: 58 },
  { month: 'Apr', revenue: 46000, bookings: 51 },
  { month: 'May', revenue: 62000, bookings: 67 },
  { month: 'Jun', revenue: 58000, bookings: 63 },
];

const userGrowthData = [
  { month: 'Jan', users: 1200 },
  { month: 'Feb', users: 1350 },
  { month: 'Mar', users: 1520 },
  { month: 'Apr', users: 1680 },
  { month: 'May', users: 1890 },
  { month: 'Jun', users: 2100 },
];

const propertyStatusData = [
  { name: 'Approved', value: 85, color: '#22c55e' },
  { name: 'Pending', value: 12, color: '#f59e0b' },
  { name: 'Rejected', value: 3, color: '#ef4444' },
];

const statusColor: Record<string, string> = {
  confirmed: 'bg-primary/10 text-primary',
  pending: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
};

const paymentStatusColor: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  refunded: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-600',
};

const menuItems = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'users', label: 'User Management', icon: Users },
  { id: 'properties', label: 'Property Management', icon: Building2 },
  { id: 'bookings', label: 'Bookings', icon: Calendar },
  { id: 'messages', label: 'Messages & Communication', icon: MessageSquare },
  { id: 'reviews', label: 'Reviews', icon: MessageSquare },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function AdminDashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('overview');
  const properties = adminProperties;
  const users = adminUsers;
  const bookings = mockBookings;
  const reviews = adminReviews;

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Total Revenue', value: formatCurrency(297000), icon: DollarSign, change: '+12%' },
          { label: 'Total Users', value: '2,100', icon: Users, change: '+15%' },
          { label: 'Active Listings', value: properties.length, icon: Home, change: '+8%' },
          { label: 'Total Bookings', value: '3,842', icon: TrendingUp, change: '+22%' },
        ].map(({ label, value, icon: Icon, change }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
              <p className="text-xs text-muted-foreground">{change} from last month</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Platform Revenue</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="revenue" fill="#004406" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>User Growth</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={userGrowthData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="users" stroke="#004406" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderUserManagement = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">User Management</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input placeholder="Search users..." className="pl-10 w-full sm:w-64" />
          </div>
          <Select>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="hosts">Hosts</SelectItem>
              <SelectItem value="guests">Guests</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
            </SelectContent>
          </Select>
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
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={user.avatar} />
                        <AvatarFallback>{user.firstName[0]}{user.lastName[0]}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{user.firstName} {user.lastName}</p>
                        <p className="text-sm text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.isHost ? "default" : "secondary"}>
                      {user.isHost ? 'Host' : 'Guest'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {user.verified && <CheckCircle className="h-4 w-4 text-green-500" />}
                      <span className="text-sm">{user.verified ? 'Verified' : 'Unverified'}</span>
                    </div>
                  </TableCell>
                  <TableCell>{new Date(user.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm">Edit</Button>
                      <Button variant="outline" size="sm" className="text-orange-600">
                        <Ban className="h-3 w-3 mr-1" /> Suspend
                      </Button>
                      <Button variant="outline" size="sm" className="text-red-600">
                        <X className="h-3 w-3 mr-1" /> Ban
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
    </div>
  );

  const renderPropertyManagement = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Property Management</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input placeholder="Search properties..." className="pl-10 w-full sm:w-64" />
          </div>
          <Select>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Property Status Distribution</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={propertyStatusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {propertyStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Property</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {properties.map((property) => (
                  <TableRow key={property.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <img src={property.images[0]} alt={property.title} className="w-12 h-8 rounded object-cover" />
                        <div>
                          <p className="font-medium truncate max-w-[200px]">{property.title}</p>
                          <p className="text-sm text-muted-foreground">{property.location.city}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{property.host.firstName} {property.host.lastName}</TableCell>
                    <TableCell>
                      <Badge variant="default">Approved</Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(property.price)}/night</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm">
                          <Eye className="h-3 w-3 mr-1" /> View
                        </Button>
                        <Button variant="outline" size="sm" className="text-orange-600">
                          Reject
                        </Button>
                        <Button variant="outline" size="sm" className="text-red-600">
                          <X className="h-3 w-3 mr-1" /> Remove
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
      </div>
    </div>
  );

  const renderBookings = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Bookings Management</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Select>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking ID</TableHead>
                <TableHead>Guest</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((booking) => (
                <TableRow key={booking.id}>
                  <TableCell className="font-mono text-sm">{booking.id}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={booking.guest.avatar} />
                        <AvatarFallback>{booking.guest.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{booking.guest.name}</p>
                        <p className="text-sm text-muted-foreground">{booking.guest.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">{booking.property}</TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <p>{booking.checkIn}</p>
                      <p className="text-muted-foreground">to {booking.checkOut}</p>
                    </div>
                  </TableCell>
                  <TableCell>{formatCurrency(booking.total)}</TableCell>
                  <TableCell>
                    <Badge className={statusColor[booking.status]}>
                      {booking.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm">View</Button>
                      {booking.status === 'pending' && (
                        <>
                          <Button variant="outline" size="sm" className="text-green-600">
                            Approve
                          </Button>
                          <Button variant="outline" size="sm" className="text-red-600">
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderReviews = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Review Moderation</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Select>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Reviews</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-4">
        {reviews.map((review) => (
          <Card key={review.id}>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <Avatar>
                    <AvatarImage src={review.user.avatar} />
                    <AvatarFallback>{review.user.firstName[0]}{review.user.lastName[0]}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="font-medium">{review.user.firstName} {review.user.lastName}</p>
                      <div className="flex items-center">
                        {[...Array(5)].map((_, i) => (
                          <span key={i} className={`text-sm ${i < review.rating ? 'text-yellow-400' : 'text-gray-300'}`}>★</span>
                        ))}
                      </div>
                      <span className="text-sm text-muted-foreground">{new Date(review.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-sm mb-4">{review.comment}</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Property: {adminProperties.find(p => p.id === review.propertyId)?.title}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="text-red-600">
                    <Flag className="h-3 w-3 mr-1" /> Flag
                  </Button>
                  <Button variant="outline" size="sm" className="text-red-600">
                    <X className="h-3 w-3 mr-1" /> Remove
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderMessages = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Messages & Communication</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button>
            <Mail className="w-4 h-4 mr-2" />
            Send Email Campaign
          </Button>
          <Button variant="outline">
            <MessageSquare className="w-4 h-4 mr-2" />
            Broadcast Message
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Email Campaigns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Welcome Email</p>
                <p className="text-sm text-muted-foreground">Sent to new users</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default">Active</Badge>
                <Button variant="outline" size="sm">Edit</Button>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Booking Confirmation</p>
                <p className="text-sm text-muted-foreground">Sent after booking</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default">Active</Badge>
                <Button variant="outline" size="sm">Edit</Button>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Monthly Newsletter</p>
                <p className="text-sm text-muted-foreground">Marketing updates</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Draft</Badge>
                <Button variant="outline" size="sm">Edit</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Message Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Booking Inquiry Response</p>
                <p className="text-sm text-muted-foreground">Auto-response template</p>
              </div>
              <Button variant="outline" size="sm">Edit</Button>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Cancellation Policy</p>
                <p className="text-sm text-muted-foreground">Policy reminder</p>
              </div>
              <Button variant="outline" size="sm">Edit</Button>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div>
                <p className="font-medium">Check-in Instructions</p>
                <p className="text-sm text-muted-foreground">Pre-arrival message</p>
              </div>
              <Button variant="outline" size="sm">Edit</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Messages</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=40&h=40&fit=crop" />
                  <AvatarFallback>SS</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">Sarah Smith</p>
                  <p className="text-sm text-muted-foreground">Question about booking process</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="destructive">New</Badge>
                <Button variant="outline" size="sm">View</Button>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=40&h=40&fit=crop" />
                  <AvatarFallback>MJ</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium">Mike Johnson</p>
                  <p className="text-sm text-muted-foreground">Property listing issue</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">2h ago</span>
                <Button variant="outline" size="sm">View</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderPayments = () => (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold">Payment Transactions</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Select>
            <SelectTrigger className="w-full sm:w-32">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="booking">Bookings</SelectItem>
              <SelectItem value="refund">Refunds</SelectItem>
              <SelectItem value="commission">Commission</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transaction ID</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockPayments.map((payment) => (
                <TableRow key={payment.id}>
                  <TableCell className="font-mono text-sm">{payment.id}</TableCell>
                  <TableCell>{payment.user}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{payment.type}</Badge>
                  </TableCell>
                  <TableCell className={payment.type === 'refund' ? 'text-red-600' : 'text-green-600'}>
                    {payment.type === 'refund' ? '-' : '+'}{formatCurrency(payment.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge className={paymentStatusColor[payment.status]}>
                      {payment.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{payment.date}</TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm">View Details</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderSecurity = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Security Dashboard</h2>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Login Activity</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockSecurityLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{log.user}</TableCell>
                    <TableCell>{log.action}</TableCell>
                    <TableCell>{log.location}</TableCell>
                    <TableCell className="text-sm">{log.timestamp}</TableCell>
                    <TableCell>
                      {log.suspicious ? (
                        <Badge variant="destructive">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Suspicious
                        </Badge>
                      ) : (
                        <Badge variant="default">Normal</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>
          <Card>
            <CardHeader><CardTitle>2FA Status</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span>Users with 2FA enabled</span>
                  <span className="font-semibold">1,456 / 2,100 (69%)</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-500 h-2 rounded-full w-[69%]"></div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Suspicious Accounts</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">user123@example.com</p>
                    <p className="text-sm text-muted-foreground">Multiple failed login attempts</p>
                  </div>
                  <Button variant="outline" size="sm" className="text-red-600">
                    <Ban className="h-3 w-3 mr-1" /> Suspend
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="font-medium">suspicious@domain.com</p>
                    <p className="text-sm text-muted-foreground">Unusual login locations</p>
                  </div>
                  <Button variant="outline" size="sm" className="text-red-600">
                    <Ban className="h-3 w-3 mr-1" /> Suspend
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Platform Settings</h2>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Platform Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Maintenance Mode</p>
                <p className="text-sm text-muted-foreground">Temporarily disable user access</p>
              </div>
              <Button variant="outline">Enable</Button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">Send system notifications</p>
              </div>
              <Button variant="outline">Configure</Button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">API Rate Limiting</p>
                <p className="text-sm text-muted-foreground">Control API usage limits</p>
              </div>
              <Button variant="outline">Configure</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fees & Policies</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium">Service Fee (%)</label>
              <div className="flex items-center gap-2 mt-1">
                <Input type="number" defaultValue="3" className="w-20" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Host Commission (%)</label>
              <div className="flex items-center gap-2 mt-1">
                <Input type="number" defaultValue="5" className="w-20" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Cancellation Policy</label>
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
            <Button className="w-full">Save Changes</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'overview': return renderOverview();
      case 'users': return renderUserManagement();
      case 'properties': return renderPropertyManagement();
      case 'bookings': return renderBookings();
      case 'reviews': return renderReviews();
      case 'messages': return renderMessages();
      case 'payments': return renderPayments();
      case 'security': return renderSecurity();
      case 'settings': return renderSettings();
      default: return renderOverview();
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
                <Button variant="outline" onClick={() => navigate('/admin/reports')}>Open Reports Center</Button>
                <Button variant="outline" onClick={() => navigate('/admin/suspensions')}>Open Suspensions Center</Button>
              </div>
            </div>
            {renderContent()}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
