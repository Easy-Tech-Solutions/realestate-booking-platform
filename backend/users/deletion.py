"""
Account-deletion service.

Why a service module instead of inlining in the view
----------------------------------------------------
Account deletion touches the user row, their profile, every listing they own,
and (potentially) cancels their auth sessions. Doing all of that inside a view
makes the view hard to test and easy to half-apply if something raises. Wrap
it in a single transactional function and the view becomes a thin caller.
"""

from datetime import date
from typing import Optional

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

User = get_user_model()


# Statuses that "hold" a booking — if any exist for this user (as guest or as
# host on one of their listings) we refuse the delete with a specific error.
ACTIVE_BOOKING_STATUSES = ('requested', 'pending', 'confirmed')


def _has_blocking_bookings(user) -> Optional[str]:
    """Return a human-readable reason string if deletion should be blocked,
    or None if it's safe to proceed."""
    from bookings.models import Booking

    today = date.today()

    as_guest = Booking.objects.filter(
        customer=user,
        status__in=ACTIVE_BOOKING_STATUSES,
        end_date__gte=today,
    ).count()

    as_host = Booking.objects.filter(
        listing__owner=user,
        status__in=ACTIVE_BOOKING_STATUSES,
        end_date__gte=today,
    ).count()

    if as_guest and as_host:
        return (
            f'You have {as_guest} upcoming booking(s) as a guest and '
            f'{as_host} on your listings. Resolve them before deleting your account.'
        )
    if as_guest:
        return (
            f'You have {as_guest} upcoming booking(s). Cancel them or wait '
            f'for them to complete before deleting your account.'
        )
    if as_host:
        return (
            f'You have {as_host} upcoming booking(s) on your listings. '
            f'Cancel or wait for them to complete before deleting your account.'
        )
    return None


def delete_account(user) -> tuple[bool, Optional[str]]:
    """Soft-delete a user account in a single transaction.

    Returns ``(success, error_message)``. On success the row remains in the
    database — only PII is anonymized — so every existing FK (bookings,
    payments, reviews, messages) keeps working and just renders "Deleted User"
    in the UI.
    """
    block = _has_blocking_bookings(user)
    if block:
        return False, block

    now = timezone.now()

    with transaction.atomic():
        # 1. Unpublish every listing the user owns. We don't hard-delete them
        #    because historical bookings still FK to the listing row.
        from listings.models import Listing
        Listing.objects.filter(owner=user, deleted_at__isnull=True).update(
            deleted_at=now,
        )

        # 2. Anonymize the user row. Keep username/email unique by suffixing
        #    the id so subsequent signups with the same address still work.
        user.username = f'deleted-user-{user.pk}'
        user.email = f'deleted-{user.pk}@homekonet.invalid'
        user.first_name = 'Deleted'
        user.last_name = 'User'
        user.email_verified = False
        user.set_unusable_password()
        user.is_active = False
        user.deleted_at = now
        user.save()

        # 3. Wipe profile PII (image, bio, momo number).
        try:
            profile = user.profile
        except Exception:
            profile = None
        if profile is not None:
            profile.bio = ''
            profile.image = None
            profile.momo_number = ''
            profile.save()

        # 4. Invalidate any refresh tokens so existing sessions stop working.
        try:
            from rest_framework_simplejwt.token_blacklist.models import OutstandingToken, BlacklistedToken
            for token in OutstandingToken.objects.filter(user=user):
                BlacklistedToken.objects.get_or_create(token=token)
        except Exception:
            # If the blacklist app isn't installed for some reason, don't
            # block the deletion — the account is already disabled.
            pass

    return True, None
