import React, { useState } from 'react';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';
import { newsletterAPI } from '../../services/api/newsletter';
import { cn } from '../../core/utils';

const INTERESTS = [
  { id: 'new_listings', label: '🏠 New listings' },
  { id: 'hotels',       label: '🏨 Hotels' },
  { id: 'discounts',    label: '🏷️ Deals & discounts' },
  { id: 'events',       label: '📅 Local events' },
];

interface NewsletterSignupProps {
  variant?: 'footer' | 'banner';
  className?: string;
}

export function NewsletterSignup({ variant = 'footer', className }: NewsletterSignupProps) {
  const [email, setEmail]           = useState('');
  const [firstName, setFirstName]   = useState('');
  const [interests, setInterests]   = useState<string[]>(['new_listings', 'discounts']);
  const [loading, setLoading]       = useState(false);
  const [success, setSuccess]       = useState(false);
  const [error, setError]           = useState('');

  const toggleInterest = (id: string) =>
    setInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await newsletterAPI.subscribe({ email: email.trim(), first_name: firstName.trim(), interests });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className={cn('flex flex-col items-center gap-3 text-center py-4', className)}>
        <CheckCircle2 className="w-10 h-10 text-primary" />
        <p className="font-semibold text-lg">You're subscribed!</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          We'll send you updates on new listings, hotels, and exclusive deals in Liberia.
        </p>
      </div>
    );
  }

  if (variant === 'banner') {
    return (
      <div className={cn('w-full', className)}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="First name (optional)"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="px-4 py-3 rounded-xl border border-white/20 bg-white/10 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/40 text-sm"
            />
            <input
              type="email"
              placeholder="Your email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              required
              className="px-4 py-3 rounded-xl border border-white/20 bg-white/10 text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-white/40 text-sm"
            />
          </div>

          {/* Interest chips */}
          <div className="flex flex-wrap gap-2">
            {INTERESTS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleInterest(id)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                  interests.includes(id)
                    ? 'bg-white text-primary border-white'
                    : 'border-white/30 text-white/70 hover:border-white hover:text-white',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {error && <p className="text-red-300 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full sm:w-auto px-8 py-3 bg-white text-primary font-semibold rounded-xl hover:bg-white/90 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {loading ? 'Subscribing…' : 'Subscribe for free'}
          </button>
        </form>
      </div>
    );
  }

  // footer variant — compact inline
  return (
    <div className={cn('space-y-3', className)}>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          placeholder="Your email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setError(''); }}
          required
          className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
          Subscribe
        </button>
      </form>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <p className="text-xs text-muted-foreground">No spam. Unsubscribe anytime.</p>
    </div>
  );
}
