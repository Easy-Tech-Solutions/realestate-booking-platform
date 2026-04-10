"""
Django signals that trigger notifications.

Pattern for detecting field changes
------------------------------------
We use pre_save to stash the *old* field values on the instance
(instance._pre_save_<field>) before Django writes to the DB.
Then post_save reads those stashed values to decide what changed.

This avoids a second DB query and doesn't require django-model-utils.

Registered signals
------------------
Booking   : new request, status changes (confirmed/declined/cancelled/completed)
Payment   : completed, failed, refunded
Message   : new message -> notify other participants
Listing   : price change, availability restored
User      : auto-create NotificationPreference on new user
"""

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver


# ---- User: auto-create preferences ------------------------------------------

@receiver(post_save, sender='users.User')
def create_notification_preferences(sender, instance, created, **kwargs):
    """Create a NotificationPreference row for every new user."""
    if created:
        from .models import NotificationPreference
        NotificationPreference.objects.get_or_create(user=instance)


# ---- Booking signals ---------------------------------------------------------

@receiver(pre_save, sender='bookings.Booking')
def booking_pre_save(sender, instance, **kwargs):
    """Cache the current status before the save so post_save can detect changes."""
    if instance.pk:
        try:
            old = sender.objects.get(pk=instance.pk)
            instance._pre_save_status = old.status
        except sender.DoesNotExist:
            instance._pre_save_status = None
    else:
        instance._pre_save_status = None


@receiver(post_save, sender='bookings.Booking')
def booking_post_save(sender, instance, created, **kwargs):
    from .services import (
        notify_booking_requested,
        notify_booking_confirmed,
        notify_booking_declined,
        notify_booking_cancelled,
        notify_booking_completed,
    )

    if created:
        notify_booking_requested(instance)
        return

    old_status = getattr(instance, '_pre_save_status', None)
    new_status = instance.status

    if old_status == new_status:
        return

    if new_status == 'confirmed':
        notify_booking_confirmed(instance)
    elif new_status == 'declined':
        notify_booking_declined(instance)
    elif new_status == 'cancelled':
        # Views that cancel bookings can call notify_booking_cancelled(booking,
        # cancelled_by_user=request.user) directly for a personalised message.
        notify_booking_cancelled(instance, cancelled_by_user=None)
    elif new_status == 'completed':
        notify_booking_completed(instance)


# ---- Payment signals ---------------------------------------------------------

@receiver(pre_save, sender='payments.Payment')
def payment_pre_save(sender, instance, **kwargs):
    """Cache the payment status before the save."""
    if instance.pk:
        try:
            old = sender.objects.get(pk=instance.pk)
            instance._pre_save_status = old.status
        except sender.DoesNotExist:
            instance._pre_save_status = None
    else:
        instance._pre_save_status = None


@receiver(post_save, sender='payments.Payment')
def payment_post_save(sender, instance, created, **kwargs):
    from .services import (
        notify_payment_received,
        notify_payment_failed,
        notify_payment_refunded,
    )

    old_status = getattr(instance, '_pre_save_status', None)
    new_status = instance.status

    if old_status == new_status:
        return

    if new_status == 'completed':
        notify_payment_received(instance)
    elif new_status == 'failed':
        notify_payment_failed(instance)
    elif new_status in ('refunded', 'partially_refunded'):
        notify_payment_refunded(instance)


# ---- Message signals ---------------------------------------------------------

@receiver(post_save, sender='messaging.Message')
def message_post_save(sender, instance, created, **kwargs):
    """Notify every participant (except the sender) about a new message."""
    if created:
        from .services import notify_new_message
        notify_new_message(instance)


# ---- Listing signals ---------------------------------------------------------

@receiver(pre_save, sender='listings.Listing')
def listing_pre_save(sender, instance, **kwargs):
    """Cache price and availability before the save."""
    if instance.pk:
        try:
            old = sender.objects.get(pk=instance.pk)
            instance._pre_save_price        = old.price
            instance._pre_save_is_available = old.is_available
        except sender.DoesNotExist:
            instance._pre_save_price        = None
            instance._pre_save_is_available = None
    else:
        instance._pre_save_price        = None
        instance._pre_save_is_available = None


@receiver(post_save, sender='listings.Listing')
def listing_post_save(sender, instance, created, **kwargs):
    from .services import notify_price_changed, notify_listing_available

    if created:
        return

    old_price        = getattr(instance, '_pre_save_price', None)
    old_is_available = getattr(instance, '_pre_save_is_available', None)

    if old_price is not None and old_price != instance.price:
        notify_price_changed(instance, old_price)

    if old_is_available is False and instance.is_available is True:
        notify_listing_available(instance)
