import React, { useMemo, useState } from 'react';
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
import { formatCurrency, formatDate } from '../../core/utils';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';
import type { Booking, Conversation, Property } from '../../core/types';
import { toast } from 'sonner';
import { getErrorMessage } from '../../services/api/shared/errors';
import { useSendMessage } from '../../hooks/queries/useMessages';
import { useDeleteHostProperty, useHostDashboardData, useRespondToHostReview, useUpdateHostProperty } from '../../hooks/queries/useHostDashboard';

type Section = 'overview' | 'properties' | 'bookings' | 'messages' | 'pricing' | 'reviews';

type DashboardMessage = {
  id: string;
  guest: string;
  property: string;
  message: string;
  timestamp: string;
  unread: boolean;
};

const navItems: { id: Section; label: string; icon: React.ElementType; badge?: number }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'properties', label: 'Properties', icon: Home },
  { id: 'bookings', label: 'Upcoming Bookings', icon: Calendar },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'pricing', label: 'Pricing', icon: DollarSign },
  { id: 'reviews', label: 'Recent Reviews', icon: Star },
];

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
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Price per night (USD)</Label>
        <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={() => onSave({ title, price: Number(price), description })}>Save changes</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function getMonthKey(dateString?: string) {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString('en-US', { month: 'short' });
}

export function HostDashboard() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<DashboardMessage | null>(null);
  const [messageReply, setMessageReply] = useState('');
  const [replyingReviewId, setReplyingReviewId] = useState<string | null>(null);
  const [reviewReply, setReviewReply] = useState('');
  const { dashboardQuery, conversationsQuery, reviews, isReviewsLoading } = useHostDashboardData();
  const updatePropertyMutation = useUpdateHostProperty();
  const deletePropertyMutation = useDeleteHostProperty();
  const respondToReviewMutation = useRespondToHostReview();
  const sendMessageMutation = useSendMessage();
  const properties = useMemo(() => ((dashboardQuery.data?.listings || []) as Property[]), [dashboardQuery.data?.listings]);
  const bookings = useMemo(() => ((dashboardQuery.data?.bookings_on_my_listings || []) as Booking[]), [dashboardQuery.data?.bookings_on_my_listings]);
  const conversations = useMemo(() => ((conversationsQuery.data || []) as Conversation[]), [conversationsQuery.data]);
  const [pricingSettings, setPricingSettings] = useState({
    basePrice: properties[0]?.price || 0,
    weekendMultiplier: 1.2,
    seasonalMultiplier: 1.3,
    minimumStay: 1,
    maximumStay: 30,
  });
  const isLoading = dashboardQuery.isLoading || conversationsQuery.isLoading || isReviewsLoading;

  React.useEffect(() => {
    if (dashboardQuery.error) {
      toast.error(getErrorMessage(dashboardQuery.error, 'Failed to load host dashboard'));
    }
  }, [dashboardQuery.error]);

  React.useEffect(() => {
    if (conversationsQuery.error) {
      toast.error(getErrorMessage(conversationsQuery.error, 'Failed to load messages'));
    }
  }, [conversationsQuery.error]);

  React.useEffect(() => {
    if (properties[0]?.price && pricingSettings.basePrice === 0) {
      setPricingSettings((current) => ({ ...current, basePrice: properties[0].price }));
    }
  }, [properties, pricingSettings.basePrice]);

  const handleSaveProperty = async (data: Partial<Property>) => {
    if (!editingProperty) return;

    const formData = new FormData();
    if (data.title !== undefined) formData.append('title', data.title);
    if (data.price !== undefined) formData.append('price', String(data.price));
    if (data.description !== undefined) formData.append('description', data.description);

    try {
      await updatePropertyMutation.mutateAsync({ id: editingProperty.id, formData });
      toast.success('Property updated');
      setEditingProperty(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update property'));
    }
  };

  const handleDeleteProperty = async (propertyId: string) => {
    try {
      await deletePropertyMutation.mutateAsync(propertyId);
      toast.success('Property deleted');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to delete property'));
    }
  };

  const handleSendMessage = async () => {
    if (!selectedMessage || !messageReply.trim()) return;

    try {
      await sendMessageMutation.mutateAsync({ conversationId: selectedMessage.id, content: messageReply.trim() });
      toast.success('Reply sent');
      setMessageReply('');
      setSelectedMessage(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to send reply'));
    }
  };

  const handleRespondToReview = async () => {
    if (!replyingReviewId || !reviewReply.trim()) return;

    try {
      await respondToReviewMutation.mutateAsync({ id: replyingReviewId, response: reviewReply.trim() });
      toast.success('Review response posted');
      setReviewReply('');
      setReplyingReviewId(null);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to post review response'));
    }
  };

  const dashboardMessages: DashboardMessage[] = useMemo(() => (
    conversations.map((conversation) => {
      const guest = conversation.participants[0]?.firstName
        ? `${conversation.participants[0].firstName} ${conversation.participants[0].lastName}`.trim()
        : conversation.participants[0]?.email || 'Guest';
      const property = properties.find((item) => item.id === conversation.propertyId)?.title || 'General conversation';
      return {
        id: conversation.id,
        guest,
        property,
        message: conversation.lastMessage?.content || 'No messages yet',
        timestamp: conversation.lastMessage?.createdAt || conversation.updatedAt,
        unread: conversation.unreadCount > 0,
      };
    })
  ), [conversations, properties]);

  const unreadCount = dashboardMessages.filter((message) => message.unread).length;

  const totalEarnings = bookings
    .filter((booking) => booking.status === 'confirmed' || booking.status === 'completed')
    .reduce((sum, booking) => {
      const property = properties.find((item) => item.id === booking.propertyId);
      const nights = Math.max(
        1,
        Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000)
      );
      return sum + (property?.price || 0) * nights;
    }, 0);

  const averageRating = reviews.length
    ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
    : 0;

  const earningsData = useMemo(() => {
    const totals = new Map<string, number>();
    bookings.forEach((booking) => {
      if (booking.status !== 'confirmed' && booking.status !== 'completed') return;
      const property = properties.find((item) => item.id === booking.propertyId);
      const nights = Math.max(
        1,
        Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86400000)
      );
      const month = getMonthKey(booking.checkIn);
      totals.set(month, (totals.get(month) || 0) + (property?.price || 0) * nights);
    });
    return Array.from(totals.entries()).map(([month, amount]) => ({ month, amount }));
  }, [bookings, properties]);

  const bookingsData = useMemo(() => {
    const totals = new Map<string, number>();
    bookings.forEach((booking) => {
      const month = getMonthKey(booking.checkIn);
      totals.set(month, (totals.get(month) || 0) + 1);
    });
    return Array.from(totals.entries()).map(([month, count]) => ({ month, bookings: count }));
  }, [bookings]);

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Earnings', value: formatCurrency(totalEarnings), icon: DollarSign, sub: 'Confirmed bookings only' },
          { label: 'Active Listings', value: properties.length, icon: Home, sub: 'Live on the platform' },
          { label: 'Total Bookings', value: bookings.length, icon: Calendar, sub: 'All requests and stays' },
          { label: 'Average Rating', value: averageRating ? averageRating.toFixed(2) : '—', icon: Star, sub: `${reviews.length} total reviews` },
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

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Earnings Overview</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={earningsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
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
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="bookings" stroke="#004406" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

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
          {properties.map((property) => (
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
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDeleteProperty(property.id)}
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              </div>
            </div>
          ))}
          {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet.</p>}
        </div>
      </CardContent>
    </Card>
  );

  const renderBookings = () => (
    <Card>
      <CardHeader><CardTitle>Upcoming Bookings</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {bookings.map((booking) => {
            const property = properties.find((item) => item.id === booking.propertyId);
            const guestName = booking.user?.firstName || booking.userId || 'Guest';
            return (
              <div key={booking.id} className="flex items-center justify-between p-4 border border-border rounded-lg">
                <div>
                  <h3 className="font-semibold mb-1">{guestName}</h3>
                  <p className="text-sm text-muted-foreground">
                    {booking.checkIn} - {booking.checkOut} · {booking.guests} guests
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{property?.title || booking.propertyId}</p>
                  <p className="text-sm font-semibold mt-1 capitalize">{booking.status}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setActiveSection('messages')}>Contact guest</Button>
              </div>
            );
          })}
          {bookings.length === 0 && <p className="text-sm text-muted-foreground">No bookings yet.</p>}
        </div>
      </CardContent>
    </Card>
  );

  const renderMessages = () => (
    <Card>
      <CardHeader><CardTitle>Messages from Guests</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-4">
          {dashboardMessages.map((message) => (
            <div key={message.id} className="border border-border rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold">{message.guest}</h3>
                    {message.unread && <Badge variant="destructive" className="text-xs">New</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">Regarding: {message.property}</p>
                  <p className="text-sm mb-2">{message.message}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(message.timestamp, 'MMM dd, yyyy hh:mm a')}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSelectedMessage(message)}>
                    <MessageSquare className="w-3 h-3 mr-1" /> Reply
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => navigate('/messages')}>
                    <Mail className="w-3 h-3 mr-1" /> Open Inbox
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {dashboardMessages.length === 0 && <p className="text-sm text-muted-foreground">No guest messages yet.</p>}
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
              { id: 'basePrice', label: 'Base Price per Night', key: 'basePrice', step: undefined },
              { id: 'weekendMultiplier', label: 'Weekend Multiplier', key: 'weekendMultiplier', step: '0.1' },
              { id: 'seasonalMultiplier', label: 'Seasonal Multiplier', key: 'seasonalMultiplier', step: '0.1' },
            ].map(({ id, label, key, step }) => (
              <div key={id}>
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  type="number"
                  step={step}
                  value={String((pricingSettings as Record<string, number>)[key])}
                  onChange={(e) => setPricingSettings((current) => ({
                    ...current,
                    [key]: Number(e.target.value),
                  }))}
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
                  id={id}
                  type="number"
                  value={String((pricingSettings as Record<string, number>)[key])}
                  onChange={(e) => setPricingSettings((current) => ({
                    ...current,
                    [key]: Number(e.target.value),
                  }))}
                />
              </div>
            ))}
            <div className="pt-2">
              <Button className="w-full" disabled>
                <Settings className="w-4 h-4 mr-2" /> Pricing is driven by listing settings
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <h3 className="text-base font-semibold mb-4">Dynamic Pricing Preview</h3>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { label: 'Weekday Price', value: pricingSettings.basePrice },
              { label: 'Weekend Price', value: pricingSettings.basePrice * pricingSettings.weekendMultiplier },
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

  const renderReviews = () => (
    <Card>
      <CardHeader><CardTitle>Recent Reviews</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-6">
          {reviews.length === 0 ? (
            <p className="text-muted-foreground text-sm">No reviews yet.</p>
          ) : reviews.map((review, index) => (
            <div key={review.id} className="space-y-3">
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
                    {Array.from({ length: review.rating }).map((_, starIndex) => (
                      <Star key={starIndex} className="w-3 h-3 fill-current text-primary" />
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{review.comment}</p>
              {review.response ? (
                <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Your response</p>
                  <p>{review.response}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    value={replyingReviewId === review.id ? reviewReply : ''}
                    onChange={(e) => {
                      setReplyingReviewId(review.id);
                      setReviewReply(e.target.value);
                    }}
                    placeholder="Write a public response to this review..."
                    rows={3}
                  />
                  <Button size="sm" onClick={handleRespondToReview} disabled={replyingReviewId !== review.id || !reviewReply.trim()}>
                    Respond
                  </Button>
                </div>
              )}
              {index < reviews.length - 1 && <Separator />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const sectionTitle = navItems.find((item) => item.id === activeSection)?.label ?? 'Host Dashboard';

  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return renderOverview();
      case 'properties':
        return renderProperties();
      case 'bookings':
        return renderBookings();
      case 'messages':
        return renderMessages();
      case 'pricing':
        return renderPricing();
      case 'reviews':
        return renderReviews();
      default:
        return null;
    }
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
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

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map(({ id, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={activeSection === id}
                      onClick={() => setActiveSection(id)}
                      tooltip={label}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {id === 'messages' && unreadCount > 0 && (
                      <SidebarMenuBadge>{unreadCount}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

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

      <SidebarInset>
        <header className="flex items-center gap-3 border-b border-border px-6 py-4 sticky top-0 bg-background z-10">
          <SidebarTrigger />
          <SidebarSeparator orientation="vertical" className="h-5" />
          <h1 className="text-xl font-semibold">{sectionTitle}</h1>
        </header>

        <div className="p-6">
          {isLoading ? <p className="text-muted-foreground">Loading dashboard...</p> : renderContent()}
        </div>
      </SidebarInset>

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
                  onChange={(e) => setMessageReply(e.target.value)}
                  placeholder="Type your response..."
                  rows={4}
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSendMessage}>Send reply</Button>
                <Button variant="outline" onClick={() => setSelectedMessage(null)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </SidebarProvider>
  );
}