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

    booking_amount = Decimal(booking.total_amount)
    host_service_fee = (booking_amount * _service_fee_rate()).quantize(Decimal('0.01'))
    amount_received = (booking_amount - host_service_fee).quantize(Decimal('0.01'))

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
    booking_amount = Decimal(booking.total_amount)
    service_fee = (booking_amount * _service_fee_rate()).quantize(Decimal('0.01'))
    total = (booking_amount + service_fee).quantize(Decimal('0.01'))

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
    booking_amount = Decimal(booking.total_amount)
    service_fee = (booking_amount * _service_fee_rate()).quantize(Decimal('0.01'))
    total = (booking_amount + service_fee).quantize(Decimal('0.01'))

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
    for admin in User.objects.filter(role='admin'):
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
    booking_amount = Decimal(booking.total_amount)
    service_fee = (booking_amount * _service_fee_rate()).quantize(Decimal('0.01'))
    total = (booking_amount + service_fee).quantize(Decimal('0.01'))

    create_notification(
        user=booking.customer,
        notification_type='booking_ready_to_pay',
        title='Reservation Confirmed — Complete Payment',
        message=(
            f'The host confirmed your reservation for "{booking.listing.title}". '
            f'Complete your payment of {total} by '
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
            f'on {viewing.viewing_date}. Schedule and confirm the appointment.'
        ),
        data={
            'viewing_id':    viewing.id,
            'listing_id':    viewing.listing.id,
            'listing_title': viewing.listing.title,
            'guest_name':    guest_name,
            'viewing_date':  str(viewing.viewing_date),
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
            f'has been confirmed. A Home Konet representative will meet you there.'
        ),
        data={
            'viewing_id':    viewing.id,
            'listing_id':    viewing.listing.id,
            'listing_title': viewing.listing.title,
            'viewing_date':  str(viewing.viewing_date),
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


# ---- Payment helpers ---------------------------------------------------------

def notify_payment_received(payment):
    """Notify the payer (success confirmation) and the property owner (income alert)."""
    listing_title = payment.booking.listing.title
    currency_code = payment.currency.code

    # Host-side numbers: the "booking amount" the guest paid for the stay
    # (excluding the guest's service fee, which stays with the platform),
    # minus our 4% commission from the host.
    booking_amount = Decimal(payment.booking.total_amount)
    rate = _service_fee_rate()
    host_service_fee = (booking_amount * rate).quantize(Decimal('0.01'))
    amount_received = (booking_amount - host_service_fee).quantize(Decimal('0.01'))

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
    admins = User.objects.filter(role='admin')

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
