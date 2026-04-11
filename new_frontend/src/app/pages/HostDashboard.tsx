import React, { useState } from 'react';
import {
  BarChart3,
  Calendar,
  DollarSign,
  Edit,
  Eye,
  Home,
  Mail,
  MessageSquare,
  Plus,
  Settings,
  Star,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '../components/ui/sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Separator } from '../components/ui/separator';
import { formatCurrency } from '../../core/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { mockProperties, mockReviews } from '../../services/mock-data';
import { Property } from '../../core/types';

// ─── Static mock data ────────────────────────────────────────────────────────

const earningsData = [
  { month: 'Jan', amount: 4200 },
  { month: 'Feb', amount: 3800 },
  { month: 'Mar', amount: 5100 },
  { month: 'Apr', amount: 4600 },
  { month: 'May', amount: 6200 },
  { month: 'Jun', amount: 5800 },
];

const bookingsData = [
  { month: 'Jan', bookings: 12 },
  { month: 'Feb', bookings: 10 },
  { month: 'Mar', bookings: 15 },
  { month: 'Apr', bookings: 13 },
  { month: 'May', bookings: 18 },
  { month: 'Jun', bookings: 16 },
];

type Section = 'overview' | 'properties' | 'bookings' | 'messages' | 'pricing' | 'reviews';

const navItems: { id: Section; label: string; icon: React.ElementType; badge?: number }[] = [
  { id: 'overview',    label: 'Overview',          icon: BarChart3 },
  { id: 'properties',  label: 'Properties',         icon: Home },
  { id: 'bookings',    label: 'Upcoming Bookings',  icon: Calendar },
  { id: 'messages',    label: 'Messages',           icon: MessageSquare, badge: 1 },
  { id: 'pricing',     label: 'Pricing',            icon: DollarSign },
  { id: 'reviews',     label: 'Recent Reviews',     icon: Star },
];

// ─── Edit property inline dialog ─────────────────────────────────────────────

function EditPropertyDialog({
  property,
  onSave,
  onCancel,
}: {
  property: Property;
  onSave: (data: Partial<Property>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(property.title);
  const [price, setPrice] = useState(String(property.price));
  const [description, setDescription] = useState(property.description);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Title</Label>
        <Input value={title} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Price per night (USD)</Label>
        <Input type="number" value={price} onChange={e => setPrice(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} />
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={() => onSave({ title, price: Number(price), description })}>Save changes</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function HostDashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [properties, setProperties] = useState(mockProperties.filter(p => p.hostId === '1'));
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [messages, setMessages] = useState([
    { id: '1', guest: 'Mike Johnson', property: 'Luxurious Beachfront Villa', message: 'Hi, I have a question about check-in time.', timestamp: '2024-05-10 14:30', unread: true },
    { id: '2', guest: 'Emma Wilson', property: 'Cozy Mountain Cabin', message: 'Can I bring my dog?', timestamp: '2024-05-09 09:15', unread: false },
  ]);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [messageReply, setMessageReply] = useState('');
  const [pricingSettings, setPricingSettings] = useState({
    basePrice: 450,
    weekendMultiplier: 1.2,
    seasonalMultiplier: 1.3,
    minimumStay: 2,
    maximumStay: 30,
  });

  const handleSaveProperty = (data: Partial<Property>) => {
    if (editingProperty) {
      setProperties(prev => prev.map(p => p.id === editingProperty.id ? { ...p, ...data } : p));
    }
    setEditingProperty(null);
  };

  const handleSendMessage = (id: string) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, unread: false } : m));
    setMessageReply('');
    setSelectedMessage(null);
  };

  const unreadCount = messages.filter(m => m.unread).length;

  // ─── Section renderers ──────────────────────────────────────────────────────

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Earnings',  value: formatCurrency(29700),    icon: DollarSign, sub: '+12.5% from last month' },
          { label: 'Active Listings', value: properties.length,        icon: Home,       sub: 'All properties active' },
          { label: 'Total Bookings',  value: 84,                       icon: Calendar,   sub: '+8 this month' },
          { label: 'Average Rating',  value: '4.92',                   icon: Star,       sub: 'Based on 284 reviews' },
        ].map(({ label, value, icon: Icon, sub }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{value}</div>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Earnings Overview</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={earningsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Bar dataKey="amount" fill="#004406" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Bookings Trend</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={bookingsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="bookings" stroke="#004406" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={() => navigate('/host/new')}>
            <Plus className="w-4 h-4 mr-2" /> Add new property
          </Button>
          <Button variant="outline" onClick={() => setActiveSection('bookings')}>
            <Calendar className="w-4 h-4 mr-2" /> View bookings
          </Button>
          <Button variant="outline" onClick={() => setActiveSection('messages')}>
            <MessageSquare className="w-4 h-4 mr-2" /> Check messages
            {unreadCount > 0 && <Badge className="ml-2">{unreadCount}</Badge>}
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  const renderProperties = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Your Properties</CardTitle>
        <Button onClick={() => navigate('/host/new')}>
          <Plus className="w-4 h-4 mr-2" /> Add new property
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {properties.map(property => (
            <div key={property.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
              <div className="flex items-center gap-4">
                <img src={property.images[0]} alt={property.title} className="w-20 h-16 rounded object-cover" />
                <div>
                  <h3 className="font-semibold">{property.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {property.location.city}, {property.location.state} · {property.rating.toFixed(1)}★ · {property.reviewCount} reviews
                  </p>
                  <p className="text-sm font-semibold mt-1">{formatCurrency(property.price)}/night</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingProperty(property)}>
                  <Edit className="w-3 h-3 mr-1" /> Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate(`/rooms/${property.id}`)}>
                  <Eye className="w-3 h-3 mr-1" /> View
                </Button>
                <Button
                  variant="outline" size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setProperties(prev => prev.filter(p => p.id !== property.id))}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const renderBookings = () => {
    const hostBookings = [
      { id: 'BK001', guestName: 'Mike Johnson', propertyTitle: properties[0]?.title ?? 'Property', checkIn: '2026-04-15', checkOut: '2026-04-20', guests: 2, total: 1250 },
      { id: 'BK002', guestName: 'Emma Wilson', propertyTitle: properties[1]?.title ?? 'Property', checkIn: '2026-05-03', checkOut: '2026-05-07', guests: 3, total: 1480 },
    ];
    return (
      <Card>
        <CardHeader><CardTitle>Upcoming Bookings</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            {hostBookings.map(b => (
              <div key={b.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                <div>
                  <h3 className="font-semibold mb-1">{b.guestName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {b.checkIn} – {b.checkOut} · {b.guests} guests
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{b.propertyTitle}</p>
                  <p className="text-sm font-semibold mt-1">{formatCurrency(b.total)}</p>
                </div>
                <Button variant="outline" size="sm">Contact guest</Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderMessages = () => (
    <Card>
      <CardHeader><CardTitle>Messages from Guests</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {messages.map(message => (
            <div key={message.id} className="border border-border rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold">{message.guest}</h3>
                    {message.unread && <Badge variant="destructive" className="text-xs">New</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">Regarding: {message.property}</p>
                  <p className="text-sm mb-2">{message.message}</p>
                  <p className="text-xs text-muted-foreground">{message.timestamp}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedMessage(message)}>
                    <MessageSquare className="w-3 h-3 mr-1" /> Reply
                  </Button>
                  <Button variant="outline" size="sm">
                    <Mail className="w-3 h-3 mr-1" /> Email
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const renderPricing = () => (
    <Card>
      <CardHeader><CardTitle>Pricing Management</CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            {[
              { id: 'basePrice',          label: 'Base Price per Night',  key: 'basePrice',          step: undefined },
              { id: 'weekendMultiplier',  label: 'Weekend Multiplier',    key: 'weekendMultiplier',  step: '0.1' },
              { id: 'seasonalMultiplier', label: 'Seasonal Multiplier',   key: 'seasonalMultiplier', step: '0.1' },
            ].map(({ id, label, key, step }) => (
              <div key={id}>
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id} type="number" step={step}
                  value={(pricingSettings as any)[key]}
                  onChange={e => setPricingSettings(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
          <div className="space-y-4">
            {[
              { id: 'minimumStay', label: 'Minimum Stay (nights)', key: 'minimumStay' },
              { id: 'maximumStay', label: 'Maximum Stay (nights)', key: 'maximumStay' },
            ].map(({ id, label, key }) => (
              <div key={id}>
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id} type="number"
                  value={(pricingSettings as any)[key]}
                  onChange={e => setPricingSettings(prev => ({ ...prev, [key]: Number(e.target.value) }))}
                />
              </div>
            ))}
            <div className="pt-2">
              <Button className="w-full">
                <Settings className="w-4 h-4 mr-2" /> Save Pricing Settings
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <h3 className="text-base font-semibold mb-4">Dynamic Pricing Preview</h3>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { label: 'Weekday Price',     value: pricingSettings.basePrice },
              { label: 'Weekend Price',     value: pricingSettings.basePrice * pricingSettings.weekendMultiplier },
              { label: 'Peak Season Price', value: pricingSettings.basePrice * pricingSettings.seasonalMultiplier },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold">{formatCurrency(value)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const renderReviews = () => {
    const hostReviews = mockReviews.filter(r => properties.some(p => p.id === r.propertyId));
    return (
      <Card>
        <CardHeader><CardTitle>Recent Reviews</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-6">
            {hostReviews.length === 0 ? (
              <p className="text-muted-foreground text-sm">No reviews yet.</p>
            ) : hostReviews.map((review, i) => (
              <div key={review.id} className="space-y-2">
                <div className="flex items-center gap-3">
                  {review.user.avatar ? (
                    <img src={review.user.avatar} alt={review.user.firstName} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                      {review.user.firstName[0]}
                    </div>
                  )}
                  <div>
                    <p className="font-semibold">{review.user.firstName} {review.user.lastName}</p>
                    <div className="flex items-center gap-0.5">
                      {[...Array(review.rating)].map((_, j) => (
                        <Star key={j} className="w-3 h-3 fill-current text-primary" />
                      ))}
                    </div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{review.comment}</p>
                {i < hostReviews.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  const sectionTitle = navItems.find(n => n.id === activeSection)?.label ?? 'Host Dashboard';

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':   return renderOverview();
      case 'properties': return renderProperties();
      case 'bookings':   return renderBookings();
      case 'messages':   return renderMessages();
      case 'pricing':    return renderPricing();
      case 'reviews':    return renderReviews();
    }
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        {/* Sidebar header */}
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-white" />
            </div>
            <div className="group-data-[collapsible=icon]:hidden">
              <p className="font-semibold text-sm leading-none">Host Dashboard</p>
              <p className="text-xs text-muted-foreground mt-0.5">Manage your listings</p>
            </div>
          </div>
        </SidebarHeader>

        {/* Nav items */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map(({ id, label, icon: Icon, badge }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={activeSection === id}
                      onClick={() => setActiveSection(id)}
                      tooltip={label}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {badge && badge > 0 && (
                      <SidebarMenuBadge>{badge}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Sidebar footer */}
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => navigate('/')} tooltip="Back to site">
                <Home />
                <span>Back to site</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      {/* Main content area */}
      <SidebarInset>
        {/* Top bar */}
        <header className="flex items-center gap-3 border-b border-border px-6 py-4 sticky top-0 bg-background z-10">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <h1 className="text-xl font-semibold">{sectionTitle}</h1>
        </header>

        <div className="p-6">
          {renderContent()}
        </div>
      </SidebarInset>

      {/* Edit Property Dialog */}
      <Dialog open={!!editingProperty} onOpenChange={() => setEditingProperty(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Property</DialogTitle>
          </DialogHeader>
          {editingProperty && (
            <EditPropertyDialog
              property={editingProperty}
              onSave={handleSaveProperty}
              onCancel={() => setEditingProperty(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Message Reply Dialog */}
      {selectedMessage && (
        <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reply to {selectedMessage.guest}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-1">Original message:</p>
                <p className="text-sm">{selectedMessage.message}</p>
              </div>
              <div>
                <Label htmlFor="reply">Your reply</Label>
                <Textarea
                  id="reply"
                  value={messageReply}
                  onChange={e => setMessageReply(e.target.value)}
                  placeholder="Type your response..."
                  rows={4}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => handleSendMessage(selectedMessage.id)}>Send reply</Button>
                <Button variant="outline" onClick={() => setSelectedMessage(null)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </SidebarProvider>
  );
}
