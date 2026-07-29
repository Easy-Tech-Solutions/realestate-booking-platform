"""
Agreement of Lease — version, long-term detection, generation & acceptance.

Bump CURRENT_LEASE_VERSION (and the template) when the lease text changes;
existing accepted leases keep their recorded version.
"""
import logging

from django.core.files.base import ContentFile
from django.utils import timezone

logger = logging.getLogger(__name__)

CURRENT_LEASE_VERSION = '1.0'
LEASE_TITLE = 'Agreement of Lease'


def is_long_term(listing) -> bool:
    """Long-term = monthly-priced listing (carries lease_term_months)."""
    return getattr(listing, 'pricing_type', None) == 'monthly'


def build_context(booking, acceptance=None) -> dict:
    """Map a booking → the values filled into the lease template."""
    listing = booking.listing
    owner   = listing.owner
    tenant  = booking.customer
    when    = booking.requested_at or timezone.now()

    property_address = ', '.join(
        p for p in [listing.address, listing.city, listing.state, listing.country] if p
    ) or (listing.address or '')

    price = listing.price or 0
    context = {
        'version':        CURRENT_LEASE_VERSION,
        'day':            when.strftime('%d'),
        'month':          when.strftime('%B'),
        'year':           when.strftime('%Y'),
        'landlord_name':  owner.get_full_name() or owner.username,
        'property_address': property_address,
        'tenant_name':    tenant.get_full_name() or tenant.username,
        'rent_display':   f'US${price:,.2f} per month',
        'lease_start':    booking.start_date.strftime('%B %d, %Y') if booking.start_date else '',
        'lease_end':      booking.end_date.strftime('%B %d, %Y') if booking.end_date else '',
        # Acceptance stamp (only rendered once the tenant accepts).
        'accepted_by':    None,
        'accepted_at':    None,
    }
    if acceptance is not None:
        context['accepted_by'] = context['tenant_name']
        context['accepted_at'] = acceptance.accepted_at.strftime('%B %d, %Y %H:%M UTC')
    return context


def _snapshot_fields(booking, context):
    return {
        'version':          context['version'],
        'landlord_name':    context['landlord_name'],
        'tenant_name':      context['tenant_name'],
        'property_address': context['property_address'],
        'rent_display':     context['rent_display'],
        'lease_start':      booking.start_date,
        'lease_end':        booking.end_date,
    }


def _render_and_store(lease, booking, acceptance=None):
    from .pdf import render_lease_pdf
    context = build_context(booking, acceptance=acceptance)
    pdf_bytes = render_lease_pdf(context)
    filename = f'lease_booking_{booking.id}_v{context["version"]}.pdf'
    lease.document.save(filename, ContentFile(pdf_bytes), save=False)
    for field, value in _snapshot_fields(booking, context).items():
        setattr(lease, field, value)
    lease.save()
    return lease


def generate_lease_for_booking(booking):
    """
    Ensure a LeaseAgreement PDF exists for this (long-term) booking. Idempotent:
    returns the existing one if already generated. Never raises — a lease-render
    failure must not break the reservation.
    """
    from .models import LeaseAgreement
    try:
        lease, created = LeaseAgreement.objects.get_or_create(
            booking=booking, defaults={'version': CURRENT_LEASE_VERSION},
        )
        if created or not lease.document:
            _render_and_store(lease, booking)
        return lease
    except Exception:
        logger.exception('Failed to generate lease for booking #%s', getattr(booking, 'id', '?'))
        return None


def record_acceptance(booking, user, ip_address=None):
    """
    Record the tenant's acceptance and re-render the lease PDF with the
    e-acceptance stamp. Idempotent per (user, booking, version).
    """
    from .models import LeaseAgreement, LeaseAcceptance
    acceptance, _ = LeaseAcceptance.objects.get_or_create(
        user=user, booking=booking, version=CURRENT_LEASE_VERSION,
        defaults={'ip_address': ip_address},
    )
    lease, _ = LeaseAgreement.objects.get_or_create(
        booking=booking, defaults={'version': CURRENT_LEASE_VERSION},
    )
    try:
        _render_and_store(lease, booking, acceptance=acceptance)
    except Exception:
        logger.exception('Failed to re-stamp lease for booking #%s', booking.id)
    return acceptance
