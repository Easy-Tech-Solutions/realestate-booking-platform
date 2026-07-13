"""
The global resource tree — every node a permission can be granted against.

`wired=True` means at least one real endpoint in the codebase actually calls
`has_permission()`/`has_any_permission()` (or the legacy `require_department()`
shim) against this exact path. `wired=False` means the node exists so roles
can be built against it and the UI can show it, but no code checks it yet —
granting it does nothing until a developer wires an endpoint to check it.
This mirrors the "AI pre-screen: not yet configured" honesty pattern used
elsewhere in this project: the catalog doesn't pretend a feature exists
before it does.

Paths are dot-separated. A grant on a parent path (e.g. 'listings') implies
every action on every descendant ('listings.content', 'listings.availability',
...) — see rbac.permissions.has_permission for the wildcard resolution. Every
parent node below is itself `wired=True`: granting one is a fully functional
wildcard (it isn't "not implemented," it just isn't checked by its own exact
string anywhere — it's checked implicitly via ancestor matching whenever any
child is checked). It's a real, working shortcut, not a placeholder.
"""

ACTIONS = ['create', 'read', 'update', 'delete', 'execute']
ACTION_LABELS = {
    'create': 'Create', 'read': 'Read', 'update': 'Update',
    'delete': 'Delete', 'execute': 'Execute',
}

# (path, label, wired, note)
RESOURCE_TREE = [
    ('users', 'Users', True, 'Wildcard — grants every user sub-resource below (profiles, PII, behavior logs, impersonation).'),
    ('users.profiles', 'Profiles', True, 'Basic account metadata — user list/search (users app).'),
    ('users.pii', 'PII', True, 'Emails, phone numbers, government ID documents captured during KYC review.'),
    ('users.behavior_logs', 'Behavior Logs', False, 'Signup IPs and device fingerprints (trustsafety.AccountSignupEvent) — captured on signup, but there is no admin endpoint to browse them yet (Django admin only). Granting this does nothing until that endpoint exists.'),
    ('users.impersonation', 'Impersonation', True, '"Login as" another user for support/debugging (superadmin.impersonate_start/stop) — every action taken is logged under the real admin\'s identity.'),

    ('listings', 'Listings', True, 'Wildcard — grants every listing sub-resource below (content, availability, compliance).'),
    ('listings.content', 'Content', True, 'Titles, descriptions, photos — approve/reject pending listings (listings app).'),
    ('listings.availability', 'Availability', True, 'Booking status, suspension state (inventory app).'),
    ('listings.compliance', 'Compliance', True, 'Local registration number + legal occupancy cap (Listing.local_registration_number/occupancy_cap) — enforced against the host\'s own max_guests. Set via PATCH /api/inventory/listings/<id>/compliance/.'),

    ('reservations', 'Reservations', True, 'Wildcard — grants every reservation sub-resource below (transactional data, communications).'),
    ('reservations.transactional_data', 'Transactional Data', True, 'Booking dates, guest counts, payment confirmation (bookings app).'),
    ('reservations.communications', 'Communications', True, 'Read-only admin view of the in-app message thread(s) between guest and host for a given booking (GET /api/bookings/admin/<id>/communications/), for dispute investigation.'),

    ('finances', 'Finances', True, 'Wildcard — grants every finance sub-resource below (escrow, payouts, taxes, legal documents, platform fees, vouchers).'),
    ('finances.escrow', 'Escrow', True, 'Bookings whose guest payment has landed but not yet been confirmed/disbursed (payments.EscrowHold can freeze one pending investigation, blocking admin_confirm_payment).'),
    ('finances.payouts', 'Payouts', True, 'Host payout records — mark paid, cancel (payments.Payout), and confirming guest payments (which creates the payout).'),
    ('finances.taxes', 'Taxes', True, 'Per-jurisdiction occupancy tax rates (payments.TaxRate) + a computed liability report over confirmed bookings. No withholding/filing/remittance automation.'),
    ('finances.legal_documents', 'Legal Documents', True, 'Terms of Service / Privacy Policy version registry (legalops app).'),
    ('finances.platform_fee', 'Platform Fee', True, 'Booking/viewing/service fee configuration (payments.PlatformFee) — takes effect immediately, no deploy needed.'),

    ('trust_safety', 'Trust & Safety', True, 'Wildcard — grants every trust & safety sub-resource below (background checks, flags, bans).'),
    ('trust_safety.background_checks', 'Background Checks', True, 'Identity/ownership verification review is manual, not automated screening — this permission (execute) grants access to every stage of the KYC review queue (hostapplications/propertyverifications), additive to the existing per-stage Django model permissions.'),
    ('trust_safety.flags', 'Flags', True, 'Rule-based fraud/listing-moderation flags (trustsafety.FraudFlag, inventory.ListingFlag).'),
    ('trust_safety.bans', 'Bans', True, 'Device/location blocks and account suspensions (trustsafety.BlockedFingerprint/BlacklistedLocation, suspensions.Suspension).'),

    ('customer_support', 'Customer Support', True, 'Wildcard — grants every support sub-resource below (tickets, disputes, AirCover claims, vouchers).'),
    ('customer_support.tickets', 'Tickets', True, 'Support ticket queue, replies, escalation (support app).'),
    ('customer_support.disputes', 'Disputes', True, 'User-submitted reports about listings/users/reviews/messages (reports.Report) — review, resolve, dismiss, escalate.'),
    ('customer_support.aircover_claims', 'AirCover Claims', True, 'Property/liability damage claim intake + review (support.AirCoverClaim). Approving a claim records an approved amount but never auto-disburses money — finance still manually issues that via the existing refund/payout tools.'),
    ('customer_support.vouchers', 'Vouchers', True, 'Discretionary refunds — backed by the real MTN MoMo refund endpoint (payments.admin_refund_payment). Amounts above the dual-authorization threshold require a second approver regardless of role.'),

    ('infrastructure', 'Infrastructure', True, 'Wildcard — grants every infrastructure sub-resource below (feature flags, caches, break-glass).'),
    ('infrastructure.feature_flags', 'Feature Flags', True, 'Platform-wide toggles (platformops.FeatureFlag).'),
    ('infrastructure.system_caches', 'System Caches', True, 'Flushes the configured Django cache backend (Redis in production).'),
    ('infrastructure.break_glass', 'Break-Glass', True, 'Request temporary full-admin elevation during an incident (rbac.BreakGlassSession) — also grantable via the built-in engineering role.'),

    ('marketing', 'Marketing', True, 'Wildcard — grants every marketing sub-resource below (testimonials, newsletter).'),
    ('marketing.testimonials', 'Testimonials', True, 'Approve/moderate customer testimonials shown on the public site (testimonials app).'),
    ('marketing.newsletter', 'Newsletter', True, 'Subscriber list management (newsletter app).'),

    ('rbac_engine', 'RBAC Engine', True, 'Create/edit custom roles and assign them to other admin accounts. Restricted to full admins by default — this is the permission that grants every other permission.'),
    ('audit_log', 'Audit Log', True, 'View the admin audit trail (superadmin.AdminAuditLog) — every sensitive action taken from this dashboard, who/what/when/why.'),
]

RESOURCE_PATHS = {r[0] for r in RESOURCE_TREE}
RESOURCE_LABELS = {r[0]: r[1] for r in RESOURCE_TREE}
WIRED_RESOURCES = {r[0] for r in RESOURCE_TREE if r[2]}


def is_valid_resource(path):
    return path in RESOURCE_PATHS


def ancestors_of(path):
    """'trust_safety.flags' -> ['trust_safety.flags', 'trust_safety']"""
    parts = path.split('.')
    return ['.'.join(parts[:i]) for i in range(len(parts), 0, -1)]
