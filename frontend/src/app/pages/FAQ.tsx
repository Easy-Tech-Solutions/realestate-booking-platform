import React, { useState } from 'react';
import { Calendar, ChevronDown, CreditCard, Home, Lock, Search, Undo2, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../core/utils';

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQCategory {
  title: string;
  icon: LucideIcon;
  items: FAQItem[];
}

const FAQ_DATA: FAQCategory[] = [
  {
    title: 'Booking & Reservations',
    icon: Calendar,
    items: [
      {
        question: 'How do I book a property on HomeKonet?',
        answer:
          'Search for a property using the search bar or browse by category. Once you find a place you like, select your dates, number of guests, and click "Book now." You\'ll be guided through a secure checkout process. Some properties support instant booking, while others require host approval first.',
      },
      {
        question: 'What is the difference between Instant Book and Request to Book?',
        answer:
          'Instant Book properties confirm your reservation right away. Request to Book properties require the host to manually review and approve your reservation — hosts have up to 7 days to respond. Either way, nothing is charged until the reservation is confirmed and you complete the separate payment step; if a host doesn\'t respond in time, the request simply expires with no charge.',
      },
      {
        question: 'Can I modify my booking after it\'s confirmed?',
        answer:
          'Modifications such as date changes depend on the host\'s availability and must be agreed upon by messaging the host through the platform. Cancel your current booking and rebook if the host cannot accommodate the change directly.',
      },
      {
        question: 'How far in advance can I book?',
        answer:
          'Most properties can be booked up to 12 months in advance. The exact availability is shown in the property\'s calendar. Last-minute bookings (same day or next day) are available for properties with that option enabled.',
      },
      {
        question: 'Can I book for someone else?',
        answer:
          'Yes. During checkout you can add a note in the Special Requests field to indicate the guest\'s name. The account holder remains responsible for the booking and must ensure all guests comply with house rules.',
      },
    ],
  },
  {
    title: 'Payments',
    icon: CreditCard,
    items: [
      {
        question: 'What payment methods does HomeKonet accept?',
        answer:
          'We accept credit/debit cards (via Stripe) and MTN Mobile Money (MoMo). All transactions are processed through secure, licensed financial institutions.',
      },
      {
        question: 'When am I charged for a booking?',
        answer:
          'Never at the moment you request a booking — that step is free. Once your reservation is confirmed (instantly for Instant Book, or after host approval for Request to Book), you have 10 days to complete payment before the reservation expires.',
      },
      {
        question: 'Is my payment information safe?',
        answer:
          'Yes. We never store your full card number or CVV. Only the last 4 digits and card type are saved for display purposes. All payments are encrypted and processed through PCI-compliant payment gateways.',
      },
      {
        question: 'Are there any service fees?',
        answer:
          'HomeKonet charges a small service fee on top of the property\'s nightly rate to cover platform maintenance, customer support, and secure payment processing. The exact fee is shown transparently at checkout before you confirm.',
      },
      {
        question: 'How does MTN Mobile Money payment work?',
        answer:
          'Select MTN Mobile Money at checkout and enter your registered MoMo number. You will receive a payment prompt on your phone. Approve the transaction and your booking will be confirmed instantly. Ensure your MoMo account has sufficient funds before initiating.',
      },
    ],
  },
  {
    title: 'Cancellations & Refunds',
    icon: Undo2,
    items: [
      {
        question: 'What is HomeKonet\'s cancellation policy?',
        answer:
          'Each property has its own cancellation policy set by the host: Flexible (full refund up to 24 hours before check-in), Moderate (full refund up to 5 days before), Strict (50% refund up to 7 days before, no refund after), and Super Strict (non-refundable). The policy is clearly shown on every listing.',
      },
      {
        question: 'How do I cancel a booking?',
        answer:
          'Go to My Bookings (Trips), find the booking you want to cancel, and click "Cancel." Refund eligibility depends on the host\'s cancellation policy shown on the listing — our team reviews and processes any refund you\'re owed rather than an amount being calculated automatically at cancellation time.',
      },
      {
        question: 'How long does a refund take?',
        answer:
          'Refund requests are reviewed by our team; once approved, how long it takes to appear in your account depends on your bank or mobile money provider. Contact Support if you\'d like a status update on a specific refund.',
      },
      {
        question: 'What if the host cancels my booking?',
        answer:
          'If a host cancels your confirmed booking, you will receive a full refund regardless of the cancellation policy. We also provide assistance in finding alternative accommodation. Hosts who cancel confirmed bookings face penalties on their account.',
      },
    ],
  },
  {
    title: 'Accounts & Profiles',
    icon: User,
    items: [
      {
        question: 'How do I create an account?',
        answer:
          'Click "Sign up" on the homepage and enter your first name, last name, email address, and a strong password. You can also sign up quickly using Google. After registering, you\'ll receive a verification email — click the link to activate your account.',
      },
      {
        question: 'I forgot my password. How do I reset it?',
        answer:
          'Click "Log in," then "Forgot password?" on the login screen. Enter your registered email address and we\'ll send you a secure reset link. The link expires after 1 hour. Check your spam folder if you don\'t see the email.',
      },
      {
        question: 'How do I update my phone number?',
        answer:
          'Go to Account → scroll to the Phone & MoMo section → enter your new number and mobile provider → click "Send verification code." Enter the 6-digit code sent to your email and phone to confirm the change.',
      },
      {
        question: 'Can I use HomeKonet without creating an account?',
        answer:
          'You can browse and search properties without an account. However, to make a booking, save wishlists, or message hosts, you will need to sign up. Registration is free.',
      },
      {
        question: 'How do I delete my account?',
        answer:
          'Go to Account and scroll to the "Danger zone" section, where you can delete your account directly. If you have upcoming bookings (as a guest, or on a listing you host) resolve them first — otherwise deletion is immediate and can\'t be undone from within the app, so contact support first if you\'re not sure.',
      },
    ],
  },
  {
    title: 'For Hosts',
    icon: Home,
    items: [
      {
        question: 'How do I list my property on HomeKonet?',
        answer:
          'Click "List your property" or go to your Host Dashboard and click "Add listing." You\'ll be guided through steps to add your property type, photos, location, pricing, house rules, and availability. Your listing goes live once submitted and reviewed.',
      },
      {
        question: 'How do I get paid as a host?',
        answer:
          'Once a guest\'s payment is confirmed, our team disburses your payout (gross amount minus HomeKonet\'s commission). Track pending and paid payouts under Host Dashboard → Earnings.',
      },
      {
        question: 'Can I set my own house rules?',
        answer:
          'Yes. During listing creation or editing, you can specify house rules such as no smoking, no pets, quiet hours, and whether security cameras or other devices are present on the property.',
      },
      {
        question: 'What is a Superhost?',
        answer:
          'Superhost status is awarded to hosts who consistently maintain high ratings, respond quickly to guests, and rarely cancel bookings. Superhosts receive a badge on their listings, greater visibility in search results, and priority support.',
      },
      {
        question: 'How do I manage hotel rooms for a hotel listing?',
        answer:
          'For properties listed as "Hotel," go to your Host Dashboard → find the hotel listing → click "Manage Rooms." You can add different room types (Standard, Deluxe, Suite, etc.) with individual prices, photos, bed configurations, and inventory counts.',
      },
    ],
  },
  {
    title: 'Safety & Trust',
    icon: Lock,
    items: [
      {
        question: 'How does HomeKonet verify listings?',
        answer:
          'Hosts are required to provide accurate information and photos. Our team reviews listings before they go live. Guests can also report any discrepancies between the listing and the actual property through the platform.',
      },
      {
        question: 'What should I do if I feel unsafe during a stay?',
        answer:
          'Your safety is our priority. If you feel unsafe, leave the property immediately and contact local emergency services (call 911 or local police). Then contact HomeKonet support at homekonnet@gmail.com with details of the incident so we can assist and investigate.',
      },
      {
        question: 'How do I report a problem with a listing or host?',
        answer:
          'Use the "Report listing" button on any property page, or contact us directly at homekonnet@gmail.com. All reports are reviewed by our Trust & Safety team within 24 hours.',
      },
      {
        question: 'Are reviews verified?',
        answer:
          'Yes. Only guests who have completed a verified stay can leave a review for a property. This ensures all reviews are genuine experiences. Hosts can respond to reviews through their dashboard.',
      },
    ],
  },
];

function FAQAccordion({ item }: { item: FAQItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-4 py-4 text-left hover:text-primary transition-colors group"
      >
        <span className="font-medium text-sm sm:text-base leading-snug group-hover:text-primary">{item.question}</span>
        <ChevronDown
          className={cn(
            'w-4 h-4 shrink-0 mt-0.5 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180 text-primary',
          )}
        />
      </button>
      {open && (
        <p className="pb-4 text-sm text-muted-foreground leading-relaxed">{item.answer}</p>
      )}
    </div>
  );
}

export function FAQ() {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const q = search.trim().toLowerCase();

  const filtered: FAQCategory[] = FAQ_DATA
    .filter((cat) => !activeCategory || cat.title === activeCategory)
    .map((cat) => ({
      ...cat,
      items: q
        ? cat.items.filter(
            (i) =>
              i.question.toLowerCase().includes(q) ||
              i.answer.toLowerCase().includes(q),
          )
        : cat.items,
    }))
    .filter((cat) => cat.items.length > 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="bg-gradient-to-br from-primary/10 via-background to-background border-b border-border">
        <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-14 text-center">
          <h1 className="text-4xl sm:text-5xl font-semibold mb-4">Frequently Asked Questions</h1>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto mb-8">
            Find answers to common questions about booking, payments, hosting, and more.
          </p>
          {/* Search */}
          <div className="relative max-w-lg mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search questions…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveCategory(null); }}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-background shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-sm"
            />
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 lg:px-20 py-12">
        {/* Category pills */}
        {!q && (
          <div className="flex flex-wrap gap-2 mb-10">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium border transition-colors',
                !activeCategory
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
              )}
            >
              All topics
            </button>
            {FAQ_DATA.map((cat) => (
              <button
                key={cat.title}
                type="button"
                onClick={() => setActiveCategory(activeCategory === cat.title ? null : cat.title)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors',
                  activeCategory === cat.title
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-primary hover:text-primary',
                )}
              >
                <cat.icon className="w-4 h-4" /> {cat.title}
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-lg font-medium mb-2">No results found</p>
            <p className="text-sm">Try a different search term or browse by category.</p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-8">
            {filtered.map((cat) => (
              <div key={cat.title} className="bg-card border border-border rounded-2xl p-6">
                <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <cat.icon className="w-5 h-5 text-primary" /> {cat.title}
                </h2>
                <div>
                  {cat.items.map((item) => (
                    <FAQAccordion key={item.question} item={item} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Still need help */}
        <div className="mt-16 text-center bg-muted/40 rounded-2xl border border-border p-10">
          <h3 className="text-2xl font-semibold mb-2">Still have questions?</h3>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Our support team is happy to help. Reach out and we'll get back to you as soon as possible.
          </p>
          <a
            href="mailto:homekonnet@gmail.com"
            className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-colors"
          >
            Contact support
          </a>
        </div>
      </div>
    </div>
  );
}
