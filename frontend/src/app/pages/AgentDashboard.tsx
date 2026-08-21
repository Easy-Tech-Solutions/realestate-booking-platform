import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Loader2, Plus, Home as HomeIcon, DollarSign, CalendarCheck, Clock } from 'lucide-react';
import { Button } from '../components/ui/button';
import { agentsAPI, type AgentDashboard as Dash } from '../../services/api/agents';

const LISTING_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  published:      { label: 'Published',       cls: 'bg-green-100 text-green-800' },
  pending_review: { label: 'Under review',    cls: 'bg-amber-100 text-amber-800' },
  rejected:       { label: 'Rejected',        cls: 'bg-red-100 text-red-800' },
  draft:          { label: 'Draft',           cls: 'bg-muted text-muted-foreground' },
};
const COMMISSION_STATUS: Record<string, string> = {
  pending: 'text-amber-700', paid: 'text-green-700', voided: 'text-muted-foreground line-through',
};

export function AgentDashboard() {
  const navigate = useNavigate();
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentsAPI.dashboard().then(setDash).catch(() => setDash(null)).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }
  if (!dash) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Could not load your agent dashboard.</div>;
  }

  const s = dash.summary;
  const tiles = [
    { label: 'Properties sourced', value: s.properties_sourced, sub: `${s.published} live · ${s.in_review} in review`, icon: HomeIcon },
    { label: 'Bookings generated', value: s.total_bookings, sub: 'On your properties', icon: CalendarCheck },
    { label: 'Commission earned', value: `$${s.commission_total}`, sub: `$${s.commission_paid} paid`, icon: DollarSign },
    { label: 'Pending commission', value: `$${s.commission_pending}`, sub: 'Awaiting disbursement', icon: Clock },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-10 max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-semibold">Agent Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Source properties for owners — Home Konet manages the rest.</p>
          </div>
          <Button onClick={() => navigate('/host/new?mode=agent')}>
            <Plus className="w-4 h-4 mr-2" /> Source a property
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
          {tiles.map((t) => (
            <div key={t.label} className="bg-card border border-border rounded-xl p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">{t.label}</span>
                <t.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <p className="text-2xl font-semibold">{t.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{t.sub}</p>
            </div>
          ))}
        </div>

        {/* Sourced properties */}
        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Your sourced properties</h2>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {dash.sourced_properties.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">You haven’t sourced any properties yet.</p>
            ) : dash.sourced_properties.map((p) => {
              const meta = LISTING_STATUS_LABEL[p.listing_status] || { label: p.listing_status, cls: 'bg-muted text-muted-foreground' };
              return (
                <div key={p.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.title}</p>
                    <p className="text-xs text-muted-foreground">Submitted {new Date(p.created_at).toLocaleDateString()}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${meta.cls}`}>{meta.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Commissions */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Commissions</h2>
          <div className="bg-card border border-border rounded-xl divide-y divide-border">
            {dash.commissions.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No commissions yet — you earn when a property you sourced gets a confirmed booking.</p>
            ) : dash.commissions.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.listing_title || 'Sourced property'}</p>
                  <p className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold">${c.amount} {c.currency}</p>
                  <p className={`text-xs capitalize ${COMMISSION_STATUS[c.status] || 'text-muted-foreground'}`}>{c.status}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
