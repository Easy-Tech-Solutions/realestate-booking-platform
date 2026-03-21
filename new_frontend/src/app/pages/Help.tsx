import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '../components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';

const categories = [
  {
    title: 'Booking & Reservations',
    faqs: [
      { q: 'How do I book a property?', a: 'Browse listings, select your dates and guests, then click Reserve. You\'ll be guided through the payment process.' },
      { q: 'Can I modify my booking after confirmation?', a: 'Yes, you can modify dates or guest count subject to host approval and availability. Go to Trips > Manage booking.' },
      { q: 'What is instant booking?', a: 'Instant booking allows you to book without waiting for host approval. Look for the lightning bolt icon on listings.' },
      { q: 'How far in advance can I book?', a: 'Most hosts allow bookings up to 12 months in advance. Check the individual listing for specific availability.' },
    ],
  },
  {
    title: 'Payments & Pricing',
    faqs: [
      { q: 'What payment methods are accepted?', a: 'We accept credit/debit cards (Visa, Mastercard, Amex), PayPal, and MTN Mobile Money.' },
      { q: 'When am I charged?', a: 'Your payment is processed immediately upon booking confirmation.' },
      { q: 'What is the service fee?', a: 'A service fee of 14% is added to cover platform costs. This is shown before you confirm your booking.' },
      { q: 'Are there any hidden fees?', a: 'No hidden fees. The total price shown at checkout includes the nightly rate, cleaning fee, service fee, and taxes.' },
    ],
  },
  {
    title: 'Cancellations & Refunds',
    faqs: [
      { q: 'What is the cancellation policy?', a: 'Each listing has its own cancellation policy (Flexible, Moderate, or Strict). Check the listing details before booking.' },
      { q: 'How do I cancel a booking?', a: 'Go to Trips, find your booking, and click Manage booking > Cancel. Refunds depend on the host\'s cancellation policy.' },
      { q: 'How long do refunds take?', a: 'Refunds are processed within 5–10 business days depending on your payment method.' },
    ],
  },
  {
    title: 'Hosting',
    faqs: [
      { q: 'How do I become a host?', a: 'Click "Switch to hosting" in the menu, then follow the listing creation wizard to publish your first property.' },
      { q: 'How do I get paid as a host?', a: 'Payouts are sent 24 hours after guest check-in via your preferred payout method set in your host account.' },
      { q: 'What is a Superhost?', a: 'Superhosts are experienced hosts with a 4.8+ rating, 10+ stays, 90%+ response rate, and less than 1% cancellation rate.' },
    ],
  },
  {
    title: 'Account & Safety',
    faqs: [
      { q: 'How do I verify my identity?', a: 'Go to Account > Login & Security > Identity verification. You\'ll need a government-issued ID.' },
      { q: 'Is my personal information safe?', a: 'Yes. We use industry-standard encryption and never share your personal details without consent.' },
      { q: 'What should I do if I feel unsafe?', a: 'Contact our 24/7 safety team immediately through the Help Center or call our emergency line.' },
    ],
  },
];

export function Help() {
  const [search, setSearch] = useState('');

  const filtered = categories.map(cat => ({
    ...cat,
    faqs: cat.faqs.filter(
      f => f.q.toLowerCase().includes(search.toLowerCase()) || f.a.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(cat => cat.faqs.length > 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-primary py-16 px-4 text-center">
        <h1 className="text-4xl font-semibold text-white mb-4">How can we help?</h1>
        <div className="relative max-w-lg mx-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            className="pl-12 h-14 text-base bg-white border-0 rounded-full shadow-lg"
            placeholder="Search for answers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12 max-w-3xl">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-muted-foreground">No results found for "{search}"</p>
          </div>
        ) : (
          <div className="space-y-10">
            {filtered.map(cat => (
              <div key={cat.title}>
                <h2 className="text-xl font-semibold mb-4">{cat.title}</h2>
                <Accordion type="single" collapsible className="border border-border rounded-xl overflow-hidden">
                  {cat.faqs.map((faq, i) => (
                    <AccordionItem key={i} value={`${cat.title}-${i}`} className="border-b border-border last:border-0 px-4">
                      <AccordionTrigger className="text-left font-medium py-4">{faq.q}</AccordionTrigger>
                      <AccordionContent className="text-muted-foreground pb-4">{faq.a}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
