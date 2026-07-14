"""
Knowledge base builder for the chatbot.

Provides two sources of grounding context:
  1. Static page content — FAQ, About, Terms, Privacy, Help copy baked in here.
  2. Live listing data   — pulled from the DB at query time (title, city, price,
                           type, bedrooms, bathrooms, status=published only).

The combined text is injected into the system prompt so the model can answer
questions about the platform and available properties without hallucinating.
"""

# ---------------------------------------------------------------------------
# Static page knowledge
# ---------------------------------------------------------------------------

STATIC_KNOWLEDGE = """
=== ABOUT HOMEKONET ===
HomeKonet is a real-estate booking platform based in Liberia. It connects
property owners (hosts) with guests looking for short-term nightly stays or
long-term monthly rentals. Supported property types include apartments, houses,
hotels, villas, rooms, suites, lodges, resorts, and more.

=== HOW BOOKING WORKS ===
1. Guest browses listings and selects a property.
2. Guest submits a booking request.
3. For instant-book listings the booking is confirmed immediately.
   For "approve first" listings the host has 7 days to confirm.
4. Once the host confirms, the guest has 10 days to complete payment.
5. Payment is made via MTN Mobile Money (MoMo) or Stripe.
6. After payment is received an admin confirms the booking and shares the
   host's contact details with the guest.
7. Long-term (monthly) listings require a viewing appointment before booking.

=== BOOKING STATUSES ===
- pending_host: Waiting for host to confirm.
- awaiting_payment: Host confirmed; guest must pay within 10 days.
- payment_received: Payment done; awaiting admin confirmation.
- confirmed: Fully confirmed; host contact shared.
- declined: Host declined the request.
- expired_unconfirmed: Host did not confirm in time.
- expired_unpaid: Guest did not pay in time.
- cancelled: Booking was cancelled.
- completed: Stay is over.

=== PAYMENTS ===
Accepted payment methods: MTN Mobile Money (MoMo) and Stripe (card).
Default currency: LRD (Liberian Dollar). USD is also supported.
Platform fees and service fees are applied at checkout.
Refunds are processed by the support team after review.

=== BECOMING A HOST ===
To list a property you must apply to become a host. Submit a host application
with your full name, address, phone number, and a government-issued ID.
Applications are reviewed by the HomeKonet team. Once approved you can create
listings from your Host Dashboard.

=== LISTING TYPES ===
Nightly listings: priced per night, suitable for short stays.
Monthly listings: priced per month, require a viewing appointment.
  Lease terms available: 6 months, 1 year, 2 years, 3 years.

=== CANCELLATION POLICIES ===
- Flexible: Full refund if cancelled well in advance.
- Moderate: Partial refund depending on notice period.
- Strict: Limited refund; cancellations close to check-in get less back.
- Super Strict: Minimal refund.

=== REVIEWS ===
Guests can leave a review after a completed stay. Reviews cover overall rating
plus sub-ratings: cleanliness, accuracy, check-in, communication, location,
and value. Hosts can respond to reviews.

=== MESSAGING ===
Guests and hosts can message each other through the platform's built-in
messaging system. File attachments are allowed once a confirmed booking exists
between the two parties.

=== ACCOUNT & PROFILE ===
Users can update their profile, change their email or phone number, and upload
a profile photo. Phone number changes require OTP verification via both email
and SMS. Email changes require re-verification.

=== SAFETY & TRUST ===
HomeKonet verifies host identities and property ownership documents (MOU /
inspection reports). Listings can be reported for policy violations. Accounts
can be suspended for serious violations.

=== SUPPORT ===
Users can submit a support ticket from the Support page. Tickets are tracked
with a unique ticket number (e.g. HK-20260101-123456). Authenticated users can
also open a direct conversation with the support team via the Messages section.
For urgent issues contact support@homekonet.com.

=== AIRCOVER ===
HomeKonet AirCover provides protection for both guests and hosts. Guests can
file a claim for safety issues or property misrepresentation. Hosts can file a
claim for property damage. Claims are reviewed by the support team.

=== VIEWINGS ===
Long-term (monthly) listings require a viewing appointment before a booking can
be confirmed. The guest pays a viewing fee, selects a date, and the host
schedules a 2-hour viewing window. After a successful viewing the host can
reserve the property for the guest.

=== FAQ ===
Q: How do I reset my password?
A: Go to the Login page and click "Forgot password". Enter your email and you
   will receive a reset link.

Q: Can I book without an account?
A: You need an account to make a booking. You can browse listings without one.

Q: How long does host approval take?
A: Host applications are typically reviewed within 2–5 business days.

Q: What currencies are accepted?
A: LRD (Liberian Dollar) and USD.

Q: How do I contact a host before booking?
A: You can message a host directly from their listing page.

Q: What is a Superhost?
A: Superhosts are experienced hosts with consistently high ratings, fast
   response times, and a strong track record of completed bookings.
"""


# ---------------------------------------------------------------------------
# Live listing data  (cached 60 s to avoid a DB hit on every message)
# ---------------------------------------------------------------------------

_listings_cache: dict = {'ts': 0.0, 'text': ''}
_LISTINGS_CACHE_TTL = 60  # seconds


def get_listings_context(limit: int = 30) -> str:
    """
    Return a compact text block describing currently published listings.
    Results are cached for 60 seconds so rapid back-and-forth messages
    don't hammer the DB.
    """
    import time
    now = time.monotonic()
    if now - _listings_cache['ts'] < _LISTINGS_CACHE_TTL and _listings_cache['text']:
        return _listings_cache['text']

    try:
        from listings.models import Listing
        qs = (
            Listing.objects
            .filter(status='published', deleted_at__isnull=True, is_available=True)
            .values('title', 'city', 'property_type', 'price',
                    'pricing_type', 'bedrooms', 'bathrooms', 'max_guests', 'booking_mode')
            .order_by('-id')[:limit]
        )
        if not qs:
            result = 'No listings are currently available.'
        else:
            lines = ['=== AVAILABLE LISTINGS ===']
            for l in qs:
                unit = 'night' if l['pricing_type'] == 'nightly' else 'month'
                mode = 'instant' if l['booking_mode'] == 'instant' else 'approval'
                lines.append(
                    f"- {l['title']} | {l['city']} | {l['property_type']} | "
                    f"{l['price']} LRD/{unit} | {l['bedrooms']}bd {l['bathrooms']}ba "
                    f"max {l['max_guests']} | {mode}"
                )
            result = '\n'.join(lines)
    except Exception:
        result = ''

    _listings_cache['ts'] = now
    _listings_cache['text'] = result
    return result


def build_knowledge_context(limit_listings: int = 30) -> str:
    listings_block = get_listings_context(limit_listings)
    return f"{STATIC_KNOWLEDGE}\n\n{listings_block}"
