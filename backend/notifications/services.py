"""
Notification service -- the single place where notifications are created.

All other code (signals, views, management commands) should call these
functions instead of touching Notification.objects.create() directly.

Flow for every notification
---------------------------
1.  Load (or create) the user's NotificationPreference row.
2.  Skip entirely if the user disabled in-app notifications.
3.  Insert a Notification row.
4.  Push a real-time event to the user's WebSocket channel group.
5.  Dispatch a Celery task to send the email (if the user's preference
    for that type is ON and the user has an email address).
"""

import logging
from decimal import Decimal

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def _service_fee_rate() -> Decimal:
    """
    Platform service fee as a fraction (e.g. Decimal('0.04')).

    Read from the admin-editable PlatformFee config so the rate lives in one
    place. The same rate is added on top of what the guest pays AND deducted
    from what the host receives, so the platform earns twice this rate overall.
    Imported lazily to avoid an import cycle with the payments app.
    """
    from payments.models import get_service_fee_rate
    return get_service_fee_rate()


def _booking_amounts(booking):
    """Canonical money breakdown for a booking.

    Uses the amounts stored at reservation time (``total_price`` already
    includes the guest service fee), which are correct for BOTH nightly and
    monthly listings. The ``total_amount`` property is nightly-only
    (price × days) and must NOT be used for monthly rentals — e.g. a $150/mo
    listing on a 365-day lease would wrongly read $54,750. Falls back to
    ``total_amount`` only for legacy rows with no stored price.
    """
    rate = _service_fee_rate()
    if booking.total_price:
        total = Decimal(str(booking.total_price))
        guest_fee = Decimal(str(booking.service_fee or 0))
    else:
        subtotal_legacy = Decimal(str(booking.total_amount))
        guest_fee = (subtotal_legacy * rate).quantize(Decimal('0.01'))
        total = subtotal_legacy + guest_fee

    subtotal = (total - guest_fee).quantize(Decimal('0.01'))
    host_fee = (subtotal * rate).quantize(Decimal('0.01'))
    host_received = (subtotal - host_fee).quantize(Decimal('0.01'))
    return {
        'subtotal': subtotal,                            # rent, excl. fees
        'guest_service_fee': guest_fee.quantize(Decimal('0.01')),
        'guest_total': total.quantize(Decimal('0.01')),  # what the guest pays
        'host_service_fee': host_fee,
        'host_received': host_received,                   # what the host nets
    }


# ---- Internal helpers --------------------------------------------------------

def _get_or_create_preferences(user):
    from .models import NotificationPreference
    prefs, _ = NotificationPreference.objects.get_or_create(user=user)
    return prefs


def _push_realtime(user_id: int, payload: dict):
    """
    Send a notification payload to the user's dedicated channel group.

    The group name  notifications_<user_id>  is the same one the
    NotificationConsumer joins on connect, so the message lands instantly
    in any open browser tab.

    Failures are caught and logged -- a missing Redis connection should never
    crash a booking or payment request.
    """
    try:
        channel_layer = get_channel_layer()
        if channel_layer is None:
            return
        async_to_sync(channel_layer.group_send)(
            f'notifications_{user_id}',
            {
                'type':         'notification_message',
                'notification': payload,
            },
        )
    except Exception as exc:
        logger.warning('Could not push real-time notification to user %s: %s', user_id, exc)


# ---- Core function -----------------------------------------------------------

def create_notification(
    user,
    notification_type: str,
    title: str,
    message: str,
    data: dict = None,
    send_email: bool = True,
):
    """
    Create a Notification, push it in real time, and optionally email the user.

    Parameters
    ----------
    user              : AUTH_USER_MODEL instance
    notification_type : one of NotificationType values (e.g. 'booking_confirmed')
    title             : short subject line (also used as email subject)
    message           : plain-text body (also used as email plain-text fallback)
    data              : dict of extra context forwarded to the email template
    send_email        : set False to suppress email (e.g. for bulk operations)

    Returns
    -------
    Notification instance, or None if in-app notifications are disabled.
    """
    from .models import Notification
    from .tasks import send_notification_email

    prefs = _get_or_create_preferences(user)

    # Always persist the Notification row so the email task has something to
    # render from and the audit history is preserved. In-app *delivery*
    # (live WebSocket push + Web Push) is gated by prefs.in_app_enabled
    # separately, and the email goes through its own per-type preference.
    notification = Notification.objects.create(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        data=data or {},
    )

    if prefs.in_app_enabled:
        # Push to WebSocket immediately (best-effort)
        _push_realtime(user.id, {
            'id':         notification.id,
            'type':       notification_type,
            'title':      title,
            'message':    message,
            'data':       data or {},
            'is_read':    False,
            'created_at': notification.created_at.isoformat(),
        })

        # Queue Web Push via Celery. Dispatch must never break the caller — a
        # broker hiccup (or, in local dev, an eager task raising) should not
        # roll back the booking/payment that triggered the notification.
        try:
            from .tasks import send_push_notification_task
            send_push_notification_task.delay(notification.id)
        except Exception as exc:
            logger.warning('Could not queue push for notification %s: %s', notification.id, exc)

    # Email is independent of the in-app toggle — its own per-type pref decides.
    if send_email and user.email and prefs.email_enabled_for(notification_type):
        try:
            send_notification_email.delay(notification.id)
        except Exception as exc:
            logger.warning('Could not queue email for notification %s: %s', notification.id, exc)

    return notification


# ---- Booking helpers ---------------------------------------------------------

def notify_booking_requested(booking):
    """Notify the property owner of a new booking request."""
    owner         = booking.listing.owner
    customer_name = booking.customer.get_full_name() or booking.customer.username

    amounts = _booking_amounts(booking)
    booking_amount = amounts['subtotal']
    host_service_fee = amounts['host_service_fee']
    amount_received = amounts['host_received']

    create_notification(
        user=owner,
        notification_type='booking_requested',
        title='New Booking Request',
        message=(
            f'{customer_name} has requested to book "{booking.listing.title}" '
            f'from {booking.start_date} to {booking.end_date}.'
        ),
        data={
            'booking_id':       booking.id,
            'listing_id':       booking.listing.id,
            'listing_title':    booking.listing.title,
            'customer_name':    customer_name,
            'start_date':       str(booking.start_date),
            'end_date':         str(booking.end_date),
            'booking_amount':   f'{booking_amount:.2f}',
            'host_service_fee': f'{host_service_fee:.2f}',
            'amount_received':  f'{amount_received:.2f}',
            # Kept for backwards compatibility with any existing UI that
            # reads `total_amount`; new templates should use the three fields
            # above instead.
            'total_amount':     f'{booking_amount:.2f}',
        },
    )


def notify_booking_submitted(booking):
    """Confirm to the guest that their booking request was submitted."""
    amounts = _booking_amounts(booking)
    booking_amount = amounts['subtotal']
    service_fee = amounts['guest_service_fee']
    total = amounts['guest_total']

    create_notification(
        user=booking.customer,
        notification_type='booking_submitted',
        title='Booking Requested',
        message=(
            f'Your request to book "{booking.listing.title}" from '
            f'{booking.start_date} to {booking.end_date} has been sent to the host. '
            f"You'll be notified once they accept or decline."
        ),
        data={
            'booking_id':     booking.id,
            'listing_id':     booking.listing.id,
            'listing_title':  booking.listing.title,
            'owner_name':     booking.listing.owner.get_full_name() or booking.listing.owner.username,
            'start_date':     str(booking.start_date),
            'end_date':       str(booking.end_date),
            'booking_amount': f'{booking_amount:.2f}',
            'service_fee':    f'{service_fee:.2f}',
            'total_amount':   f'{total:.2f}',
        },
    )


def notify_booking_confirmed(booking):
    """Notify the customer their booking was confirmed."""
    amounts = _booking_amounts(booking)
    booking_amount = amounts['subtotal']
    service_fee = amounts['guest_service_fee']
    total = amounts['guest_total']

    create_notification(
        user=booking.customer,
        notification_type='booking_confirmed',
        title='Booking Confirmed!',
        message=(
            f'Your booking for "{booking.listing.title}" '
            f'from {booking.start_date} to {booking.end_date} has been confirmed.'
        ),
        data={
            'booking_id':     booking.id,
            'listing_id':     booking.listing.id,
            'listing_title':  booking.listing.title,
            'owner_name':     booking.listing.owner.get_full_name() or booking.listing.owner.username,
            'start_date':     str(booking.start_date),
            'end_date':       str(booking.end_date),
            'booking_amount': f'{booking_amount:.2f}',
            'service_fee':    f'{service_fee:.2f}',
            'total_amount':   f'{total:.2f}',
            'owner_notes':    booking.owner_notes,
        },
    )


def notify_booking_declined(booking):
    """Notify the customer their booking was declined."""
    create_notification(
        user=booking.customer,
        notification_type='booking_declined',
        title='Booking Declined',
        message=(
            f'Your booking request for "{booking.listing.title}" was declined. '
            f'Reason: {booking.decline_reason or "No reason provided."}'
        ),
        data={
            'booking_id':     booking.id,
            'listing_id':     booking.listing.id,
            'listing_title':  booking.listing.title,
            'decline_reason': booking.decline_reason,
        },
    )


def notify_booking_cancelled(booking, cancelled_by_user=None):
    """
    Notify the *other* party when a booking is cancelled.

    Pass cancelled_by_user to determine which side initiated the cancellation.
    If None, a generic message is sent to both parties.
    """
    if cancelled_by_user is None:
        for recipient in [booking.customer, booking.listing.owner]:
            create_notification(
                user=recipient,
                notification_type='booking_cancelled',
                title='Booking Cancelled',
                message=f'The booking for "{booking.listing.title}" has been cancelled.',
                data={
                    'booking_id':    booking.id,
                    'listing_id':    booking.listing.id,
                    'listing_title': booking.listing.title,
                },
            )
        return

    notify_user = (
        booking.listing.owner
        if cancelled_by_user == booking.customer
        else booking.customer
    )
    actor = cancelled_by_user.get_full_name() or cancelled_by_user.username

    create_notification(
        user=notify_user,
        notification_type='booking_cancelled',
        title='Booking Cancelled',
        message=(
            f'The booking for "{booking.listing.title}" '
            f'from {booking.start_date} to {booking.end_date} was cancelled by {actor}.'
        ),
        data={
            'booking_id':    booking.id,
            'listing_id':    booking.listing.id,
            'listing_title': booking.listing.title,
            'cancelled_by':  actor,
            'start_date':    str(booking.start_date),
            'end_date':      str(booking.end_date),
        },
    )


def notify_booking_completed(booking):
    """Notify the customer their stay is complete and prompt a review."""
    create_notification(
        user=booking.customer,
        notification_type='booking_completed',
        title='Stay Complete - Leave a Review!',
        message=(
            f'Your stay at "{booking.listing.title}" is complete. '
            "We hope you enjoyed it! Don't forget to leave a review."
        ),
        data={
            'booking_id':    booking.id,
            'listing_id':    booking.listing.id,
            'listing_title': booking.listing.title,
        },
    )


# ---- Reservation flow helpers (revised booking flow) -------------------------

def _notify_admins(notification_type, title, message, data=None):
    """Fan a notification out to every admin user."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    for admin in User.objects.filter(role__in=('admin', 'superadmin')):
        create_notification(
            user=admin,
            notification_type=notification_type,
            title=title,
            message=message,
            data=data or {},
        )


def notify_reservation_requested(booking):
    """
    A guest reserved a property (free). Notify the host (to confirm) and admins.
    Reuses the host-facing 'booking_requested' notification for the host.
    """
    notify_booking_requested(booking)

    customer_name = booking.customer.get_full_name() or booking.customer.username
    _notify_admins(
        notification_type='reservation_pending_admin',
        title='New Reservation',
        message=(
            f'{customer_name} reserved "{booking.listing.title}" '
            f'({booking.start_date} → {booking.end_date}). Awaiting host confirmation.'
        ),
        data={
            'booking_id':    booking.id,
            'listing_id':    booking.listing.id,
            'listing_title': booking.listing.title,
            'customer_name': customer_name,
        },
    )


def notify_reservation_ready_to_pay(booking):
    """Host confirmed the reservation — tell the guest to pay within the window."""
    amounts = _booking_amounts(booking)
    booking_amount = amounts['subtotal']
    service_fee = amounts['guest_service_fee']
    total = amounts['guest_total']

    create_notification(
        user=booking.customer,
        notification_type='booking_ready_to_pay',
        title='Reservation Confirmed — Complete Payment',
        message=(
            f'The host confirmed your reservation for "{booking.listing.title}". '
            f'Complete your payment of ${total} by '
            f'{booking.payment_due_at:%Y-%m-%d %H:%M UTC} to secure it.'
        ),
        data={
            'booking_id':     booking.id,
            'listing_id':     booking.listing.id,
            'listing_title':  booking.listing.title,
            'booking_amount': f'{booking_amount:.2f}',
            'service_fee':    f'{service_fee:.2f}',
            'total_amount':   f'{total:.2f}',
            'payment_due_at': booking.payment_due_at.isoformat() if booking.payment_due_at else None,
        },
    )


def notify_payment_awaiting_admin(booking):
    """A guest paid — notify admins that the payment needs confirmation."""
    customer_name = booking.customer.get_full_name() or booking.customer.username
    _notify_admins(
        notification_type='payment_awaiting_admin',
        title='Payment Awaiting Confirmation',
        message=(
            f'{customer_name} paid for "{booking.listing.title}". '
            f'Confirm the payment to release host contact details and create the payout.'
        ),
        data={
            'booking_id':    booking.id,
            'listing_id':    booking.listing.id,
            'listing_title': booking.listing.title,
            'customer_name': customer_name,
        },
    )


def notify_host_payment_received(booking):
    """
    Notify the host that the guest's payment landed and Home Konet will disburse
    their share. Fired when a booking reaches 'payment_received'.
    """
    owner = booking.listing.owner
    amounts = _booking_amounts(booking)
    create_notification(
        user=owner,
        notification_type='payment_received_host',
        title='Payment Received',
        message=(
            f'The guest has paid for "{booking.listing.title}". '
            f"You'll receive {amounts['host_received']} after our commission — "
            f"Home Konet's team will disburse it to your account shortly."
        ),
        data={
            'booking_id':       booking.id,
            'listing_id':       booking.listing.id,
            'listing_title':    booking.listing.title,
            'booking_amount':   f"{amounts['subtotal']:.2f}",
            'host_service_fee': f"{amounts['host_service_fee']:.2f}",
            'amount_received':  f"{amounts['host_received']:.2f}",
        },
    )


def notify_reservation_expired(booking, reason='unpaid'):
    """
    Notify the guest (and host, if the reservation was confirmed) that a
    reservation expired. reason is 'unconfirmed' (host never confirmed) or
    'unpaid' (guest never paid in time → listing relisted).
    """
    if reason == 'unconfirmed':
        guest_msg = (
            f'Your reservation for "{booking.listing.title}" expired because the '
            f'host did not confirm in time. You can reserve it again if it is still available.'
        )
    else:
        guest_msg = (
            f'Your reservation for "{booking.listing.title}" expired because payment '
            f'was not completed in time. The property has been relisted.'
        )

    create_notification(
        user=booking.customer,
        notification_type='reservation_expired',
        title='Reservation Expired',
        message=guest_msg,
        data={
            'booking_id':    booking.id,
            'listing_id':    booking.listing.id,
            'listing_title': booking.listing.title,
            'reason':        reason,
        },
    )

    if reason == 'unpaid':
        create_notification(
            user=booking.listing.owner,
            notification_type='reservation_expired',
            title='Reservation Expired — Property Relisted',
            message=(
                f'A confirmed reservation for "{booking.listing.title}" expired '
                f'because the guest did not pay in time. The property has been relisted.'
            ),
            data={
                'booking_id':    booking.id,
                'listing_id':    booking.listing.id,
                'listing_title': booking.listing.title,
                'reason':        reason,
            },
        )


def notify_viewing_requested(viewing):
    """A guest requested a property viewing — notify admins to schedule it."""
    guest_name = viewing.guest.get_full_name() or viewing.guest.username
    _notify_admins(
        notification_type='viewing_requested',
        title='New Viewing Request',
        message=(
            f'{guest_name} requested a viewing of "{viewing.listing.title}" '
            f'on {viewing.viewing_date} ({viewing.viewing_time_range}). '
            f'Schedule and confirm the appointment.'
        ),
        data={
            'viewing_id':    viewing.id,
            'listing_id':    viewing.listing.id,
            'listing_title': viewing.listing.title,
            'guest_name':    guest_name,
            'viewing_date':  str(viewing.viewing_date),
            'viewing_time':  viewing.viewing_time_range,
        },
    )


def notify_viewing_fee_paid(viewing, payment=None):
    """Receipt to the guest after their (non-refundable) viewing fee is paid.

    Delivered in-app and by email (a notification-and-receipt email). The
    `payment` gives the exact amount/method/reference; we fall back to the
    viewing's stored fee if it isn't supplied.
    """
    amount = payment.amount if payment is not None else viewing.viewing_fee
    amount_str = f'{Decimal(str(amount)):.2f}'
    currency = payment.currency.code if (payment is not None and getattr(payment, 'currency', None)) else 'USD'
    method = payment.get_payment_method_display() if payment is not None else ''
    reference = str(payment.id) if payment is not None else ''

    create_notification(
        user=viewing.guest,
        notification_type='viewing_fee_paid',
        title='Viewing Fee Paid — Receipt',
        message=(
            f'We received your {amount_str} {currency} viewing fee for '
            f'"{viewing.listing.title}". Our team will schedule and confirm your '
            f'visit on {viewing.viewing_date} ({viewing.viewing_time_range}).'
        ),
        data={
            'viewing_id':     viewing.id,
            'listing_id':     viewing.listing.id,
            'listing_title':  viewing.listing.title,
            'viewing_date':   str(viewing.viewing_date),
            'viewing_time':   viewing.viewing_time_range,
            'amount':         f'{Decimal(str(amount)):.2f}',
            'currency':       currency,
            'payment_method': method,
            'payment_id':     reference,
        },
    )


def notify_viewing_scheduled(viewing):
    """Admin scheduled/confirmed the viewing — notify the guest."""
    create_notification(
        user=viewing.guest,
        notification_type='viewing_scheduled',
        title='Viewing Scheduled',
        message=(
            f'Your viewing of "{viewing.listing.title}" on {viewing.viewing_date} '
            f'({viewing.viewing_time_range}) has been confirmed. A Home Konet '
            f'representative will meet you there.'
        ),
        data={
            'viewing_id':    viewing.id,
            'listing_id':    viewing.listing.id,
            'listing_title': viewing.listing.title,
            'viewing_date':  str(viewing.viewing_date),
            'viewing_time':  viewing.viewing_time_range,
        },
    )


def notify_payout_pending(payout):
    """Notify admins that a host payout is now owed."""
    host_name = payout.host.get_full_name() or payout.host.username
    _notify_admins(
        notification_type='payout_pending',
        title='Host Payout Pending',
        message=(
            f'A payout of {payout.net_amount} {payout.currency} is owed to '
            f'{host_name} for "{payout.booking.listing.title}".'
        ),
        data={
            'payout_id':     str(payout.id),
            'booking_id':    payout.booking_id,
            'host_name':     host_name,
            'net_amount':    f'{payout.net_amount:.2f}',
            'currency':      payout.currency,
        },
    )


def notify_payout_paid(payout):
    """Notify the host that their payout has been disbursed to their account."""
    listing_title = payout.booking.listing.title if payout.booking_id else 'your booking'
    create_notification(
        user=payout.host,
        notification_type='payout_paid',
        title='Payout Sent',
        message=(
            f'Home Konet has disbursed {payout.net_amount} {payout.currency} to you '
            f'for "{listing_title}". It should reach your account shortly.'
        ),
        data={
            'payout_id':     str(payout.id),
            'booking_id':    payout.booking_id,
            'listing_title': listing_title,
            'net_amount':    f'{payout.net_amount:.2f}',
            'currency':      payout.currency,
            'reference':     payout.reference or '',
        },
    )


# ---- Payment helpers ---------------------------------------------------------

def notify_payment_received(payment):
    """Notify the payer (success confirmation) and the property owner (income alert)."""
    # Booking/rent payments only — viewing-fee payments have no booking.
    if not payment.booking_id:
        return
    listing_title = payment.booking.listing.title
    currency_code = payment.currency.code

    # Host-side numbers: the "booking amount" the guest paid for the stay
    # (excluding the guest's service fee, which stays with the platform),
    # minus our commission from the host. Uses the stored booking totals so
    # monthly listings are correct (not nightly price × days).
    amounts = _booking_amounts(payment.booking)
    booking_amount = amounts['subtotal']
    host_service_fee = amounts['host_service_fee']
    amount_received = amounts['host_received']

    # Guest sees what they actually paid (includes their 4% service fee).
    create_notification(
        user=payment.user,
        notification_type='payment_received',
        title='Payment Successful',
        message=f'Your payment of {payment.amount} {currency_code} for "{listing_title}" was successful.',
        data={
            'payment_id':    str(payment.id),
            'booking_id':    payment.booking.id,
            'listing_id':    payment.booking.listing.id,
            'listing_title': listing_title,
            'amount':        str(payment.amount),
            'currency':      currency_code,
        },
    )

    # Host sees the booking-level breakdown — what the guest paid for the
    # stay, our commission, and what the host nets.
    owner = payment.booking.listing.owner
    if owner != payment.user:
        create_notification(
            user=owner,
            notification_type='payment_received_host',
            title='Payment Received',
            message=(
                f'A guest has paid for "{listing_title}". You will receive '
                f'{amount_received} {currency_code} after our {rate * 100:.0f}% commission.'
            ),
            data={
                'payment_id':       str(payment.id),
                'booking_id':       payment.booking.id,
                'listing_id':       payment.booking.listing.id,
                'listing_title':    listing_title,
                'currency':         currency_code,
                'booking_amount':   f'{booking_amount:.2f}',
                'host_service_fee': f'{host_service_fee:.2f}',
                'amount_received':  f'{amount_received:.2f}',
            },
        )


def notify_payment_failed(payment):
    """Notify the payer their payment failed."""
    create_notification(
        user=payment.user,
        notification_type='payment_failed',
        title='Payment Failed',
        message=(
            f'Your payment of {payment.amount} {payment.currency.code} '
            f'for "{payment.booking.listing.title}" failed. Please try again.'
        ),
        data={
            'payment_id':    str(payment.id),
            'booking_id':    payment.booking.id,
            'listing_id':    payment.booking.listing.id,
            'listing_title': payment.booking.listing.title,
            'amount':        str(payment.amount),
            'currency':      payment.currency.code,
        },
    )


def notify_payment_refunded(payment):
    """Notify the payer a refund has been processed."""
    create_notification(
        user=payment.user,
        notification_type='payment_refunded',
        title='Refund Processed',
        message=(
            f'A refund of {payment.amount} {payment.currency.code} '
            f'for "{payment.booking.listing.title}" has been processed.'
        ),
        data={
            'payment_id':    str(payment.id),
            'booking_id':    payment.booking.id,
            'listing_id':    payment.booking.listing.id,
            'listing_title': payment.booking.listing.title,
            'amount':        str(payment.amount),
            'currency':      payment.currency.code,
        },
    )


# ---- Messaging helpers -------------------------------------------------------

def notify_new_message(message):
    """
    Notify every conversation participant except the sender.

    Preview is capped at 100 chars to avoid leaking long message bodies in emails.
    """
    conversation  = message.conversation
    sender_name   = message.sender.get_full_name() or message.sender.username
    listing_title = conversation.listing.title if conversation.listing else 'General Chat'
    preview       = message.content[:100] + ('...' if len(message.content) > 100 else '')

    recipients = conversation.participants.exclude(id=message.sender.id)
    for user in recipients:
        create_notification(
            user=user,
            notification_type='new_message',
            title=f'New message from {sender_name}',
            message=f'{sender_name}: {preview}',
            data={
                'conversation_id': conversation.id,
                'message_id':      message.id,
                'sender_name':     sender_name,
                'listing_title':   listing_title,
                'listing_id':      conversation.listing.id if conversation.listing else None,
            },
        )


# ---- Listing helpers ---------------------------------------------------------

def notify_price_changed(listing, old_price):
    """
    Notify every user who favorited this listing that the price changed.
    Called from the Listing pre_save signal which captures the old price.
    """
    from listings.models import Favorite

    direction = 'decreased' if listing.price < old_price else 'increased'
    favorites = Favorite.objects.filter(listing=listing).select_related('user')

    for fav in favorites:
        create_notification(
            user=fav.user,
            notification_type='price_changed',
            title=f'Price {direction.capitalize()} - {listing.title}',
            message=(
                f'The price for "{listing.title}" has {direction} '
                f'from {old_price} to {listing.price}.'
            ),
            data={
                'listing_id':    listing.id,
                'listing_title': listing.title,
                'old_price':     str(old_price),
                'new_price':     str(listing.price),
                'direction':     direction,
            },
        )


def notify_listing_available(listing):
    """Notify favoriting users when a listing becomes available again."""
    from listings.models import Favorite

    favorites = Favorite.objects.filter(listing=listing).select_related('user')
    for fav in favorites:
        create_notification(
            user=fav.user,
            notification_type='listing_available',
            title=f'Listing Available - {listing.title}',
            message=f'"{listing.title}" is now available for booking.',
            data={
                'listing_id':    listing.id,
                'listing_title': listing.title,
            },
        )


# ---- Report helpers ----------------------------------------------------------

def notify_report_submitted(report):
    """
    Notify every admin user that a new report has been filed.
    Called immediately after a Report is saved.
    """
    from django.contrib.auth import get_user_model
    User = get_user_model()

    reporter_name = report.reporter.get_full_name() or report.reporter.username
    admins = User.objects.filter(role__in=('admin', 'superadmin'))

    for admin in admins:
        create_notification(
            user=admin,
            notification_type='report_submitted',
            title='New Report Filed',
            message=(
                f'{reporter_name} filed a "{report.get_report_type_display()}" report '
                f'on a {report.get_content_type_display()}.'
            ),
            data={
                'report_id':     report.id,
                'report_type':   report.report_type,
                'content_type':  report.content_type,
                'reporter_name': reporter_name,
            },
        )


def notify_account_suspended(suspension):
    """
    Notify the suspended user that their account has been actioned.
    Called immediately after a Suspension record is created.
    """
    type_labels = {
        'temporary':  'temporarily',
        'indefinite': 'indefinitely',
        'permanent':  'permanently',
    }
    adverb  = type_labels.get(suspension.suspension_type, '')
    message = f'Your account has been {adverb} suspended.'
    if suspension.ends_at:
        message += f' The suspension will be lifted on {suspension.ends_at.strftime("%Y-%m-%d %H:%M UTC")}.'

    create_notification(
        user=suspension.user,
        notification_type='account_suspended',
        title='Account Suspended',
        message=message,
        data={
            'suspension_id':   suspension.pk,
            'suspension_type': suspension.suspension_type,
            'reason':          suspension.reason,
            'ends_at':         suspension.ends_at.isoformat() if suspension.ends_at else None,
        },
    )


def notify_account_reinstated(suspension):
    """
    Notify the user that their suspension has been lifted (revoked or expired).
    """
    if suspension.status == 'revoked':
        message = 'Your account suspension has been lifted by an administrator. You can now log in again.'
    else:
        message = 'Your temporary suspension has expired. You can now log in again.'

    create_notification(
        user=suspension.user,
        notification_type='account_reinstated',
        title='Account Reinstated',
        message=message,
        data={
            'suspension_id': suspension.pk,
            'status':        suspension.status,
        },
    )


def notify_report_updated(report):
    """
    Notify the reporter that the status of their report has changed.
    Called by the admin update endpoint whenever status changes.
    """
    status_labels = {
        'under_review': 'is now under review',
        'resolved':     'has been resolved',
        'dismissed':    'has been dismissed',
    }
    label = status_labels.get(report.status, f'was updated to "{report.get_status_display()}"')

    create_notification(
        user=report.reporter,
        notification_type='report_updated',
        title='Your Report Was Updated',
        message=f'Your report (#{report.id}) {label}.',
        data={
            'report_id':   report.id,
            'report_type': report.report_type,
            'new_status':  report.status,
            'admin_notes': report.admin_notes,
        },
    )


# ---- Host application helpers ------------------------------------------------

def _notify_group(group_name, notification_type, title, message, data=None):
    """Fan a notification out to every active member of a Django Group."""
    from django.contrib.auth import get_user_model
    User = get_user_model()
    recipients = User.objects.filter(groups__name=group_name, is_active=True).distinct()
    for member in recipients:
        create_notification(
            user=member,
            notification_type=notification_type,
            title=title,
            message=message,
            data=data or {},
        )


def _host_application_data(application):
    return {
        'application_id': application.id,
        'applicant_name': application.full_name,
        'status':         application.status,
    }


def notify_host_application_submitted(application):
    """A user submitted a host application — notify the Product Support Officers."""
    from hostapplications.models import GROUP_PRODUCT_SUPPORT
    _notify_group(
        GROUP_PRODUCT_SUPPORT,
        notification_type='host_application_submitted',
        title='New Host Application',
        message=(
            f'{application.full_name} applied to become a host. '
            f'Review the application to approve or decline it.'
        ),
        data=_host_application_data(application),
    )


def notify_host_application_advanced(application):
    """
    An application was approved at one stage — notify the next stage's reviewers.
    Routed by the application's new status.
    """
    from hostapplications.models import (
        HostApplication, GROUP_COMPLIANCE, GROUP_SUPERVISOR,
    )
    next_group = {
        HostApplication.Status.PS_APPROVED:         GROUP_COMPLIANCE,
        HostApplication.Status.COMPLIANCE_APPROVED: GROUP_SUPERVISOR,
    }.get(application.status)
    if not next_group:
        return

    _notify_group(
        next_group,
        notification_type='host_application_advanced',
        title='Host Application Awaiting Review',
        message=(
            f"{application.full_name}'s host application has advanced to your stage. "
            f'Please review it to approve or decline.'
        ),
        data=_host_application_data(application),
    )


def notify_host_application_received(application):
    """Confirm to the applicant that their host application was received."""
    create_notification(
        user=application.applicant,
        notification_type='host_application_received',
        title='We Received Your Host Application',
        message=(
            'Thanks for applying to become a host on Home Konet. Our team is now '
            "reviewing your application — we'll email you at each step."
        ),
        data={'application_id': application.id},
    )


def notify_host_application_progress(application):
    """
    Tell the applicant their application cleared a review stage and moved to the
    next one. Fired on each intermediate approval (not the final one — that uses
    notify_host_application_approved).
    """
    from hostapplications.models import HostApplication
    labels = {
        HostApplication.Status.PS_APPROVED:         ('Product Support', 'the Compliance team'),
        HostApplication.Status.COMPLIANCE_APPROVED: ('Compliance', 'a Supervisor for final approval'),
    }.get(application.status)
    if not labels:
        return
    passed_stage, next_stage = labels

    create_notification(
        user=application.applicant,
        notification_type='host_application_progress',
        title='Your Host Application Is Moving Forward',
        message=(
            f'Good news — your host application passed the {passed_stage} review '
            f'and is now with {next_stage}. We\'ll email you at each step.'
        ),
        data={
            'application_id': application.id,
            'passed_stage':   passed_stage,
            'next_stage':     next_stage,
            'status':         application.status,
        },
    )


def notify_host_application_declined(application):
    """Notify the applicant that their application was declined, with the reason."""
    create_notification(
        user=application.applicant,
        notification_type='host_application_declined',
        title='Host Application Declined',
        message=(
            'Unfortunately your application to become a host was not approved. '
            f'Reason: {application.decline_reason or "No reason provided."}'
        ),
        data={
            'application_id': application.id,
            'decline_reason': application.decline_reason,
            'declined_stage': application.declined_stage,
        },
    )


def notify_host_application_approved(application):
    """Notify the applicant that they are now a host and can list properties."""
    create_notification(
        user=application.applicant,
        notification_type='host_application_approved',
        title="You're Approved — Welcome, Host!",
        message=(
            'Congratulations! Your application has been approved and your account '
            'is now a host account. You can start listing your properties.'
        ),
        data={'application_id': application.id},
    )


# ---- Property verification helpers -------------------------------------------

def _property_verification_data(verification):
    return {
        'verification_id': verification.id,
        'listing_id':      verification.listing_id,
        'listing_title':   verification.listing.title,
        'ownership_type':  verification.ownership_type,
        'status':          verification.status,
    }


def notify_property_verification_submitted(verification):
    """A listing was submitted for verification — notify the Product Support Officers."""
    from propertyverifications.models import GROUP_PRODUCT_SUPPORT
    _notify_group(
        GROUP_PRODUCT_SUPPORT,
        notification_type='property_verification_submitted',
        title='New Property Verification',
        message=(
            f'"{verification.listing.title}" was submitted for verification. '
            f'Review the property details and documents to approve, reject, or request a correction.'
        ),
        data=_property_verification_data(verification),
    )


def notify_property_verification_advanced(verification):
    """Approved at one stage — notify the next stage's reviewers."""
    from propertyverifications.models import (
        PropertyVerification, GROUP_COMPLIANCE, GROUP_SUPERVISOR,
    )
    next_group = {
        PropertyVerification.Status.PS_APPROVED:         GROUP_COMPLIANCE,
        PropertyVerification.Status.COMPLIANCE_APPROVED: GROUP_SUPERVISOR,
    }.get(verification.status)
    if not next_group:
        return
    _notify_group(
        next_group,
        notification_type='property_verification_advanced',
        title='Property Verification Awaiting Review',
        message=(
            f'The verification for "{verification.listing.title}" has advanced to your stage. '
            f'Please review it.'
        ),
        data=_property_verification_data(verification),
    )


def notify_property_verification_received(verification):
    """Confirm to the host that their property was submitted for verification."""
    create_notification(
        user=verification.applicant,
        notification_type='property_verification_received',
        title='Property Submitted for Verification',
        message=(
            f'Thanks — "{verification.listing.title}" has been submitted for verification. '
            f"Our team will review it and we'll email you at each step. It will be published once approved."
        ),
        data=_property_verification_data(verification),
    )


def notify_property_verification_progress(verification):
    """Tell the host their property cleared a review stage."""
    from propertyverifications.models import PropertyVerification
    labels = {
        PropertyVerification.Status.PS_APPROVED:         ('Product Support', 'the Compliance team (site inspection)'),
        PropertyVerification.Status.COMPLIANCE_APPROVED: ('Compliance', 'a Supervisor for final approval'),
    }.get(verification.status)
    if not labels:
        return
    passed_stage, next_stage = labels
    create_notification(
        user=verification.applicant,
        notification_type='property_verification_progress',
        title='Your Property Verification Is Moving Forward',
        message=(
            f'"{verification.listing.title}" passed the {passed_stage} review and is now with '
            f'{next_stage}.'
        ),
        data={**_property_verification_data(verification),
              'passed_stage': passed_stage, 'next_stage': next_stage},
    )


def notify_property_verification_correction(verification):
    """Ask the host to correct and resubmit their property verification."""
    create_notification(
        user=verification.applicant,
        notification_type='property_verification_correction',
        title='Correction Needed on Your Property Listing',
        message=(
            f'Your listing "{verification.listing.title}" needs a correction before it can be '
            f'published. {verification.review_notes or "Please review and resubmit."}'
        ),
        data={**_property_verification_data(verification),
              'review_notes': verification.review_notes,
              'outcome_stage': verification.outcome_stage},
    )


def notify_property_verification_rejected(verification):
    """Notify the host their property verification was rejected."""
    create_notification(
        user=verification.applicant,
        notification_type='property_verification_rejected',
        title='Property Verification Declined',
        message=(
            f'Your listing "{verification.listing.title}" was not approved. '
            f'Reason: {verification.review_notes or "No reason provided."}'
        ),
        data={**_property_verification_data(verification),
              'review_notes': verification.review_notes,
              'outcome_stage': verification.outcome_stage},
    )


def notify_property_verification_published(verification):
    """Notify the host their property passed verification and is now live."""
    create_notification(
        user=verification.applicant,
        notification_type='property_verification_published',
        title='Your Property Is Live!',
        message=(
            f'Great news — "{verification.listing.title}" passed verification and is now '
            f'published on Home Konet.'
        ),
        data=_property_verification_data(verification),
    )


def notify_phone_number_changed(user, old_number, new_number, network_provider):
    """
    Notify the user that their mobile wallet number was successfully changed.
    Sent as both an in-app notification and an email so the user has a paper
    trail — important for a security-sensitive account change.
    """
    network_label = 'MTN Mobile Money' if network_provider == 'mtn' else 'Orange Money'
    masked_old = f"{'*' * (len(old_number) - 4)}{old_number[-4:]}" if len(old_number) >= 4 else old_number
    masked_new = f"{'*' * (len(new_number) - 4)}{new_number[-4:]}" if len(new_number) >= 4 else new_number

    create_notification(
        user=user,
        notification_type='phone_number_changed',
        title=f'{network_label} Number Updated',
        message=(
            f'Your {network_label} wallet number has been changed from '
            f'{masked_old} to {masked_new}. '
            f'If you did not make this change, contact support immediately.'
        ),
        data={
            'network_provider': network_provider,
            'old_number_masked': masked_old,
            'new_number_masked': masked_new,
        },
    )
