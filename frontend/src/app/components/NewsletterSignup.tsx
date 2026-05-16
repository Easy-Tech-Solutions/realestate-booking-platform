import React, { useState } from 'react';
import { Mail, CheckCircle2, Loader2 } from 'lucide-react';
import { newsletterAPI } from '../../services/api/newsletter';
import { cn } from '../../core/utils';

interface NewsletterSignupProps {
  className?: string;
}

export function NewsletterSignup({ className }: NewsletterSignupProps) {
  const [email, setEmail]         = useState('');
  const [firstName, setFirstName] = useState('');
  const [loading, setLoading]     = useState(false);
  const [success, setSuccess]     = useState(false);
  const [error, setError]         = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await newsletterAPI.subscribe({ email: email.trim(), first_name: firstName.trim() });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
        <p className="text-sm font-medium">You're subscribed! We'll keep you updated.</p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <form onSubmit={handleSubmit} className="space-y-2">
        <input
          type="text"
          placeholder="First name (optional)"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
        />
        <div className="flex gap-2">
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
        </div>
      </form>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <p className="text-xs text-muted-foreground">No spam. Unsubscribe anytime.</p>
    </div>
  );
}
