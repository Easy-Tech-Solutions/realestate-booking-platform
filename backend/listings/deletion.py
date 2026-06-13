"""
Listing-deletion service. Same soft-delete pattern as users: mark the row
with ``deleted_at`` and exclude from public surfaces, but keep the row so
historical bookings/payments/reviews still resolve their FKs.
"""

from datetime import date
from typing import Optional

from django.db import transaction
from django.utils import timezone


# Booking statuses that block listing deletion — same set the account
# deletion service uses so the rules stay consistent.
ACTIVE_BOOKING_STATUSES = ('requested', 'pending', 'confirmed')


def _has_blocking_bookings(listing) -> Optional[str]:
    """Return a human-readable reason string if deletion should be blocked,
    or None if it's safe to proceed."""
    from bookings.models import Booking

    count = Booking.objects.filter(
        listing=listing,
        status__in=ACTIVE_BOOKING_STATUSES,
        end_date__gte=date.today(),
    ).count()

    if count:
        return (
            f'This listing has {count} upcoming booking(s). Cancel or wait '
            f'for them to complete before deleting it.'
        )
    return None


def delete_listing(listing) -> tuple[bool, Optional[str]]:
    """Soft-delete a listing. Returns ``(success, error_message)``."""
    block = _has_blocking_bookings(listing)
    if block:
        return False, block

    with transaction.atomic():
        listing.deleted_at = timezone.now()
        listing.is_available = False
        listing.save(update_fields=['deleted_at', 'is_available'])

    return True, None
