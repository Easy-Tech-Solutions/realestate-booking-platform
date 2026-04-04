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

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


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

    if not prefs.in_app_enabled:
        return None

    notification = Notification.objects.create(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
        data=data or {},
    )

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

    # Queue email via Celery (or run synchronously in dev with ALWAYS_EAGER)
    if send_email and user.email and prefs.email_enabled_for(notification_type):
        send_notification_email.delay(notification.id)

    return notification


# ---- Booking helpers ---------------------------------------------------------

def notify_booking_requested(booking):
    """Notify the property owner of a new booking request."""
    owner         = booking.listing.owner
    customer_name = booking.customer.get_full_name() or booking.customer.username
    create_notification(
        user=owner,
        notification_type='booking_requested',
        title='New Booking Request',
        message=(
            f'{customer_name} has requested to book "{booking.listing.title}" '
            f'from {booking.start_date} to {booking.end_date}.'
        ),
        data={
            'booking_id':    booking.id,
            'listing_id':    booking.listing.id,
            'listing_title': booking.listing.title,
            'customer_name': customer_name,
            'start_date':    str(booking.start_date),
            'end_date':      str(booking.end_date),
            'total_amount':  str(booking.total_amount),
        },
    )


def notify_booking_confirmed(booking):
    """Notify the customer their booking was confirmed."""
    create_notification(
        user=booking.customer,
        notification_type='booking_confirmed',
        title='Booking Confirmed!',
        message=(
            f'Your booking for "{booking.listing.title}" '
            f'from {booking.start_date} to {booking.end_date} has been confirmed.'
        ),
        data={
            'booking_id':    booking.id,
            'listing_id':    booking.listing.id,
            'listing_title': booking.listing.title,
            'owner_name':    booking.listing.owner.get_full_name() or booking.listing.owner.username,
            'start_date':    str(booking.start_date),
            'end_date':      str(booking.end_date),
            'total_amount':  str(booking.total_amount),
            'owner_notes':   booking.owner_notes,
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


# ---- Payment helpers ---------------------------------------------------------

def notify_payment_received(payment):
    """Notify the payer (success confirmation) and the property owner (income alert)."""
    listing_title = payment.booking.listing.title
    amount_str    = f'{payment.amount} {payment.currency.code}'
    common_data   = {
        'payment_id':    str(payment.id),
        'booking_id':    payment.booking.id,
        'listing_id':    payment.booking.listing.id,
        'listing_title': listing_title,
        'amount':        str(payment.amount),
        'currency':      payment.currency.code,
    }

    create_notification(
        user=payment.user,
        notification_type='payment_received',
        title='Payment Successful',
        message=f'Your payment of {amount_str} for "{listing_title}" was successful.',
        data=common_data,
    )

    owner = payment.booking.listing.owner
    if owner != payment.user:
        create_notification(
            user=owner,
            notification_type='payment_received',
            title='Payment Received',
            message=f'You received a payment of {amount_str} for "{listing_title}".',
            data=common_data,
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
