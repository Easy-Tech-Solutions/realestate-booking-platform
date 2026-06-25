"""
Listing-deletion service.

A host deleting a listing should actually remove it when there's nothing worth
keeping. We only fall back to a soft-delete (mark ``deleted_at`` + hide from
every surface) when the listing has bookings that must survive for records —
i.e. money was received or the booking was confirmed/completed — so those
bookings/payments/payouts still resolve their foreign keys.
"""

from typing import Optional

from django.db import transaction
from django.db.models import Q
from django.utils import timezone


# Bookings that make a listing worth preserving (a soft-delete) rather than
# hard-deleting. These represent real money/commitments and their records must
# not disappear. Everything else (pending requests, unpaid/expired/declined/
# cancelled) is safe to remove along with the listing.
RECORD_BOOKING_STATUSES = ('payment_received', 'confirmed', 'completed')


def delete_listing(listing) -> tuple[bool, Optional[str]]:
    """Delete a listing. Returns ``(success, error_message)``.

    Hard-deletes when the listing has no record-worthy bookings; otherwise
    soft-deletes so historical bookings/payments/payouts still resolve.
    """
    from bookings.models import Booking
    from payments.models import Payment

    has_booking_records = Booking.objects.filter(
        listing=listing,
        status__in=RECORD_BOOKING_STATUSES,
    ).exists()
    # A completed payment (rent or a viewing fee) is a record we must keep even
    # if there's no record-worthy booking (e.g. a paid viewing that never
    # converted to a reservation).
    has_payment_records = Payment.objects.filter(
        Q(booking__listing=listing) | Q(viewing__listing=listing),
        status='completed',
    ).exists()

    if has_booking_records or has_payment_records:
        with transaction.atomic():
            listing.deleted_at = timezone.now()
            listing.is_available = False
            listing.save(update_fields=['deleted_at', 'is_available'])
        return True, None

    # Nothing to preserve — remove the listing entirely (cascades to its
    # pending/cancelled bookings, images, favorites, etc.).
    listing.delete()
    return True, None
