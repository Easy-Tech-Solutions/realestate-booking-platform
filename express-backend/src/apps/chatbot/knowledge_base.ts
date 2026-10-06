// chatbot/knowledge_base.py — static knowledge + live listing context (cached 60 s).

import { db } from '../../db/index.js';
import { quantizeStr, pgDec } from '../messaging/pyutil.js';

export const STATIC_KNOWLEDGE = "\n=== ABOUT HOMEKONET ===\nHomeKonet is a real-estate booking platform based in Liberia. It connects\nproperty owners (hosts) with guests looking for short-term nightly stays or\nlong-term monthly rentals. Supported property types include apartments, houses,\nhotels, villas, rooms, suites, lodges, resorts, and more.\n\n=== HOW BOOKING WORKS ===\n1. Guest browses listings and selects a property.\n2. Guest submits a booking request.\n3. For instant-book listings the booking is confirmed immediately.\n   For \"approve first\" listings the host has 7 days to confirm.\n4. Once the host confirms, the guest has 10 days to complete payment.\n5. Payment is made via MTN Mobile Money (MoMo) or Stripe.\n6. After payment is received an admin confirms the booking and shares the\n   host's contact details with the guest.\n7. Long-term (monthly) listings require a viewing appointment before booking.\n\n=== BOOKING STATUSES ===\n- pending_host: Waiting for host to confirm.\n- awaiting_payment: Host confirmed; guest must pay within 10 days.\n- payment_received: Payment done; awaiting admin confirmation.\n- confirmed: Fully confirmed; host contact shared.\n- declined: Host declined the request.\n- expired_unconfirmed: Host did not confirm in time.\n- expired_unpaid: Guest did not pay in time.\n- cancelled: Booking was cancelled.\n- completed: Stay is over.\n\n=== PAYMENTS ===\nAccepted payment methods: MTN Mobile Money (MoMo) and Stripe (card).\nDefault currency: LRD (Liberian Dollar). USD is also supported.\nPlatform fees and service fees are applied at checkout.\nRefunds are processed by the support team after review.\n\n=== BECOMING A HOST ===\nTo list a property you must apply to become a host. Submit a host application\nwith your full name, address, phone number, and a government-issued ID.\nApplications are reviewed by the HomeKonet team. Once approved you can create\nlistings from your Host Dashboard.\n\n=== LISTING TYPES ===\nNightly listings: priced per night, suitable for short stays.\nMonthly listings: priced per month, require a viewing appointment.\n  Lease terms available: 6 months, 1 year, 2 years, 3 years.\n\n=== CANCELLATION POLICIES ===\n- Flexible: Full refund if cancelled well in advance.\n- Moderate: Partial refund depending on notice period.\n- Strict: Limited refund; cancellations close to check-in get less back.\n- Super Strict: Minimal refund.\n\n=== REVIEWS ===\nGuests can leave a review after a completed stay. Reviews cover overall rating\nplus sub-ratings: cleanliness, accuracy, check-in, communication, location,\nand value. Hosts can respond to reviews.\n\n=== MESSAGING ===\nGuests and hosts can message each other through the platform's built-in\nmessaging system. File attachments are allowed once a confirmed booking exists\nbetween the two parties.\n\n=== ACCOUNT & PROFILE ===\nUsers can update their profile, change their email or phone number, and upload\na profile photo. Phone number changes require OTP verification via both email\nand SMS. Email changes require re-verification.\n\n=== SAFETY & TRUST ===\nHomeKonet verifies host identities and property ownership documents (MOU /\ninspection reports). Listings can be reported for policy violations. Accounts\ncan be suspended for serious violations.\n\n=== SUPPORT ===\nUsers can submit a support ticket from the Support page. Tickets are tracked\nwith a unique ticket number (e.g. HK-20260101-123456). Authenticated users can\nalso open a direct conversation with the support team via the Messages section.\nFor urgent issues contact support@homekonet.com.\n\n=== AIRCOVER ===\nHomeKonet AirCover provides protection for both guests and hosts. Guests can\nfile a claim for safety issues or property misrepresentation. Hosts can file a\nclaim for property damage. Claims are reviewed by the support team.\n\n=== VIEWINGS ===\nLong-term (monthly) listings require a viewing appointment before a booking can\nbe confirmed. The guest pays a viewing fee, selects a date, and the host\nschedules a 2-hour viewing window. After a successful viewing the host can\nreserve the property for the guest.\n\n=== FAQ ===\nQ: How do I reset my password?\nA: Go to the Login page and click \"Forgot password\". Enter your email and you\n   will receive a reset link.\n\nQ: Can I book without an account?\nA: You need an account to make a booking. You can browse listings without one.\n\nQ: How long does host approval take?\nA: Host applications are typically reviewed within 2\u20135 business days.\n\nQ: What currencies are accepted?\nA: LRD (Liberian Dollar) and USD.\n\nQ: How do I contact a host before booking?\nA: You can message a host directly from their listing page.\n\nQ: What is a Superhost?\nA: Superhosts are experienced hosts with consistently high ratings, fast\n   response times, and a strong track record of completed bookings.\n";

const cache = { ts: 0, text: '' };
const TTL_MS = 60_000;

/** get_listings_context(limit=30) */
export async function getListingsContext(limit = 30): Promise<string> {
  const now = performance.now();
  if (now - cache.ts < TTL_MS && cache.text) return cache.text;
  let result: string;
  try {
    const rows = await db.selectFrom('listings_listing')
      .select(['title', 'city', 'property_type', 'price', 'pricing_type', 'bedrooms', 'bathrooms', 'max_guests', 'booking_mode'])
      .where('status', '=', 'published').where('deleted_at', 'is', null).where('is_available', '=', true)
      .orderBy('id', 'desc').limit(limit).execute();
    if (!rows.length) result = 'No listings are currently available.';
    else {
      const lines = ['=== AVAILABLE LISTINGS ==='];
      for (const l of rows) {
        const unit = l.pricing_type === 'nightly' ? 'night' : 'month';
        const mode = l.booking_mode === 'instant' ? 'instant' : 'approval';
        const p = pgDec(String(l.price));
        lines.push(`- ${l.title} | ${l.city} | ${l.property_type} | ${quantizeStr(p.coef, p.scale, p.scale)} LRD/${unit} | ${l.bedrooms}bd ${l.bathrooms}ba max ${l.max_guests} | ${mode}`);
      }
      result = lines.join('\n');
    }
  } catch {
    result = '';
  }
  cache.ts = now;
  cache.text = result;
  return result;
}

export async function buildKnowledgeContext(limitListings = 30): Promise<string> {
  return `${STATIC_KNOWLEDGE}\n\n${await getListingsContext(limitListings)}`;
}
