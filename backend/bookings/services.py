"""
Booking state machine for the revised booking flow.

Single place where reservation transitions happen, so the API views, the
Django admin actions, and the Celery expiry tasks all share identical logic.

Lifecycle
---------
    reserve (free) → pending_host
        host confirms (≤7d) → awaiting_payment   (listing pulled, 10-day clock)
        host misses 7d       → expired_unconfirmed
    awaiting_payment
        guest pays (≤10d) → payment_received → (admin confirms) → confirmed (+ Payout)
        guest misses 10d  → expired_unpaid       (listing relisted)

On host confirmation, all *other* pending reservations on the same listing
whose dates overlap are automatically declined (the host picks the winner).
"""
import logging
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import Booking, ViewingAppointment, PAYMENT_WINDOW_DAYS

logger = logging.getLogger(__name__)


def _pull_listing(listing):
    """Remove a listing from public view while a reservation holds it."""
    if listing.is_available:
        listing.is_available = False
        listing.save(update_fields=['is_available'])


def _relist_listing(listing):
    """Return a listing to public view after a reservation falls through."""
    if not listing.is_available:
        listing.is_available = True
        listing.save(update_fields=['is_available'])
        try:
            from notifications.services import notify_listing_available
            notify_listing_available(listing)
        except Exception as exc:
            logger.warning('Could not send listing-available notifications: %s', exc)


def _decline_competing_reservations(winning_booking):
    """
    Decline every other pending reservation on the same listing whose dates
    overlap the winner. Called when the host confirms one reservation.

    The decline notification is sent by the booking_post_save signal when the
    status flips to 'declined' — no explicit notify here (avoids a double send).
    """
    competitors = Booking.objects.filter(
        listing=winning_booking.listing,
        status='pending_host',
        start_date__lt=winning_booking.end_date,
        end_date__gt=winning_booking.start_date,
    ).exclude(pk=winning_booking.pk)

    for booking in competitors:
        booking.status = 'declined'
        booking.declined_at = timezone.now()
        booking.decline_reason = 'The host confirmed another reservation for these dates.'
        booking.save(update_fields=['status', 'declined_at', 'decline_reason'])


@transaction.atomic
def host_confirm_reservation(booking):
    """
    Host accepts a reservation: pull the listing, start the 10-day payment
    clock, decline competing reservations, and tell the guest to pay.
    """
    booking.mark_host_confirmed()
    _decline_competing_reservations(booking)
    _pull_listing(booking.listing)

    try:
        from notifications.services import notify_reservation_ready_to_pay
        notify_reservation_ready_to_pay(booking)
    except Exception as exc:
        logger.warning('Could not notify guest to pay for booking %s: %s', booking.pk, exc)

    return booking


def mark_viewing_fee_paid(viewing):
    """
    Mark a viewing's non-refundable fee as paid (called once a gateway confirms
    the charge). Idempotent. Notifies admins so they can schedule the visit.
    """
    if viewing is None or viewing.is_fee_paid:
        return viewing
    viewing.is_fee_paid = True
    viewing.fee_paid_at = timezone.now()
    if viewing.status == 'requested':
        viewing.status = 'fee_paid'
    viewing.save(update_fields=['is_fee_paid', 'fee_paid_at', 'status'])
    try:
        from notifications.services import notify_viewing_requested
        notify_viewing_requested(viewing)
    except Exception as exc:
        logger.warning('Could not notify admins of paid viewing %s: %s', viewing.pk, exc)
    return viewing


def mark_guest_paid(booking):
    """
    Guest completed payment — move to payment_received and notify admins so
    they can confirm and disburse. Called by the payment-confirmation flow.
    """
    booking.status = 'payment_received'
    booking.save(update_fields=['status'])
    try:
        from notifications.services import notify_payment_awaiting_admin
        notify_payment_awaiting_admin(booking)
    except Exception as exc:
        logger.warning('Could not notify admins of payment for booking %s: %s', booking.pk, exc)
    return booking


@transaction.atomic
def admin_confirm_payment(booking, admin_user=None):
    """
    Admin confirms a received payment: finalize the booking, share host contact
    (via the confirmed notification), and create the host Payout record.
    """
    booking.status = 'confirmed'
    booking.confirmed_at = timezone.now()
    booking.save(update_fields=['status', 'confirmed_at'])

    payout = create_payout_for_booking(booking)

    # The confirmation notification (which shares host contact) is sent by the
    # booking_post_save signal on the status→confirmed change — not here.
    if payout:
        try:
            from notifications.services import notify_payout_pending
            notify_payout_pending(payout)
        except Exception as exc:
            logger.warning('Could not notify admins of payout for booking %s: %s', booking.pk, exc)

    return booking


@transaction.atomic
def process_booking_decline(booking, decline_reason='', owner_notes=''):
    """
    Decline a booking and put the listing back on the market if nothing else
    is holding it. Used by the host decline endpoint and the admin action so
    both relist + notify consistently.
    """
    booking.status = 'declined'
    booking.declined_at = timezone.now()
    if decline_reason:
        booking.decline_reason = decline_reason
    if owner_notes:
        booking.owner_notes = owner_notes
    booking.save(update_fields=['status', 'declined_at', 'decline_reason', 'owner_notes'])

    # Relist only if no other booking still holds this listing (a pulled listing
    # is held by exactly one awaiting_payment/payment_received/confirmed booking).
    still_held = Booking.objects.filter(
        listing=booking.listing,
        status__in=['awaiting_payment', 'payment_received', 'confirmed'],
    ).exclude(pk=booking.pk).exists()
    if not still_held:
        _relist_listing(booking.listing)

    # The booking_post_save signal already sends the decline notification when
    # the status flips to 'declined' — no explicit call needed here.
    return booking


@transaction.atomic
def reserve_property_from_viewing(viewing, start_date, end_date, total_price, service_fee):
    """
    Guest clicked "Reserve Property" after a completed viewing (Path C).

    Creates a Booking already in awaiting_payment (the viewing stands in for
    host confirmation), pulls the listing, starts the 10-day payment clock,
    and links the booking back to the viewing.
    """
    now = timezone.now()
    booking = Booking.objects.create(
        listing=viewing.listing,
        customer=viewing.guest,
        start_date=start_date,
        end_date=end_date,
        status='awaiting_payment',
        requires_viewing=True,
        total_price=total_price,
        service_fee=service_fee,
        host_confirmed_at=now,
        payment_due_at=now + timedelta(days=PAYMENT_WINDOW_DAYS),
    )
    viewing.booking = booking
    viewing.status = 'reserved'
    viewing.save(update_fields=['booking', 'status'])

    _pull_listing(viewing.listing)

    try:
        from notifications.services import notify_reservation_ready_to_pay
        notify_reservation_ready_to_pay(booking)
    except Exception as exc:
        logger.warning('Could not notify guest to pay for viewing booking %s: %s', booking.pk, exc)

    return booking


def create_payout_for_booking(booking):
    """
    Create (idempotently) the host disbursement record for a confirmed booking.

    gross   = the rent the guest paid for the stay (excludes the guest's fee)
    fee     = platform commission deducted from the host (service_fee_rate)
    net     = what the host receives
    """
    from payments.models import Payout, get_service_fee_rate

    if hasattr(booking, 'payout'):
        return booking.payout

    # Gross = the rent the guest actually paid, i.e. the charged total minus the
    # guest-side service fee. Falls back to the nightly total_amount for legacy
    # rows that predate stored total_price/service_fee.
    if booking.total_price is not None:
        gross = (Decimal(booking.total_price) - Decimal(booking.service_fee or 0)).quantize(Decimal('0.01'))
    else:
        gross = Decimal(booking.total_amount).quantize(Decimal('0.01'))
    fee = (gross * get_service_fee_rate()).quantize(Decimal('0.01'))
    net = (gross - fee).quantize(Decimal('0.01'))

    return Payout.objects.create(
        booking=booking,
        host=booking.listing.owner,
        gross_amount=gross,
        service_fee_amount=fee,
        net_amount=net,
    )


# ---- Expiry (called by Celery beat) -----------------------------------------

def expire_unconfirmed_reservations():
    """
    Expire reservations the host never confirmed within HOST_CONFIRM_DAYS.
    Idempotent — safe to run repeatedly.
    """
    from notifications.services import notify_reservation_expired

    now = timezone.now()
    stale = Booking.objects.filter(
        status='pending_host',
        host_confirm_deadline__isnull=False,
        host_confirm_deadline__lte=now,
    )
    count = 0
    for booking in stale:
        booking.status = 'expired_unconfirmed'
        booking.save(update_fields=['status'])
        try:
            notify_reservation_expired(booking, reason='unconfirmed')
        except Exception as exc:
            logger.warning('expire_unconfirmed: notify failed for %s: %s', booking.pk, exc)
        count += 1
    logger.info('expire_unconfirmed_reservations: expired %d reservation(s)', count)
    return count


def expire_unpaid_reservations():
    """
    Expire host-confirmed reservations the guest never paid within
    PAYMENT_WINDOW_DAYS, and relist the property. Idempotent.
    """
    from notifications.services import notify_reservation_expired

    now = timezone.now()
    stale = Booking.objects.filter(
        status='awaiting_payment',
        payment_due_at__isnull=False,
        payment_due_at__lte=now,
    ).select_related('listing')
    count = 0
    for booking in stale:
        booking.status = 'expired_unpaid'
        booking.save(update_fields=['status'])
        _relist_listing(booking.listing)
        try:
            notify_reservation_expired(booking, reason='unpaid')
        except Exception as exc:
            logger.warning('expire_unpaid: notify failed for %s: %s', booking.pk, exc)
        count += 1
    logger.info('expire_unpaid_reservations: expired %d reservation(s)', count)
    return count
