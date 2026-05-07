from django.db import models
from django.conf import settings
from django.utils import timezone


class NotificationType(models.TextChoices):
    # Booking lifecycle
    BOOKING_REQUESTED  = 'booking_requested',  'Booking Requested'
    BOOKING_CONFIRMED  = 'booking_confirmed',  'Booking Confirmed'
    BOOKING_DECLINED   = 'booking_declined',   'Booking Declined'
    BOOKING_CANCELLED  = 'booking_cancelled',  'Booking Cancelled'
    BOOKING_COMPLETED  = 'booking_completed',  'Booking Completed'
    # Payments
    PAYMENT_RECEIVED   = 'payment_received',   'Payment Received'
    PAYMENT_FAILED     = 'payment_failed',     'Payment Failed'
    PAYMENT_REFUNDED   = 'payment_refunded',   'Payment Refunded'
    # Messaging
    NEW_MESSAGE        = 'new_message',        'New Message'
    # Listings
    PRICE_CHANGED      = 'price_changed',      'Price Changed'
    LISTING_AVAILABLE  = 'listing_available',  'Listing Available'
    # Search
    SEARCH_ALERT       = 'search_alert',       'Search Alert'
    # Reviews
    NEW_REVIEW         = 'new_review',         'New Review'
    # Reports
    REPORT_SUBMITTED   = 'report_submitted',   'Report Submitted'
    REPORT_UPDATED     = 'report_updated',     'Report Updated'
    # Account actions
    ACCOUNT_SUSPENDED  = 'account_suspended',  'Account Suspended'
    ACCOUNT_REINSTATED = 'account_reinstated', 'Account Reinstated'
    # Account security
    PHONE_NUMBER_CHANGED = 'phone_number_changed', 'Phone Number Changed'


class Notification(models.Model):
    """
    A single notification record for a user.

    Every event in the system (booking, payment, message, price change, ...)
    creates one of these. The same record drives:
      - The in-app notification bell (REST API)
      - The real-time WebSocket push (Django Channels)
      - The async email delivery (Celery)
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    notification_type = models.CharField(
        max_length=50,
        choices=NotificationType.choices,
        db_index=True,
    )
    title   = models.CharField(max_length=255)
    message = models.TextField()

    # Extra context passed to the email template (booking_id, listing_title, ...)
    data = models.JSONField(default=dict, blank=True)

    is_read    = models.BooleanField(default=False, db_index=True)
    email_sent = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.user.username} - {self.notification_type} ({self.created_at:%Y-%m-%d})'

    def mark_read(self):
        if not self.is_read:
            self.is_read = True
            self.read_at = timezone.now()
            self.save(update_fields=['is_read', 'read_at'])


class NotificationPreference(models.Model):
    """
    One row per user — individual on/off toggles for every notification type.

    Created automatically (via signal) when a new User is created.
    Defaults: everything ON so new users receive all notifications out of the box.
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notification_preferences',
    )

    # Booking
    booking_requested_email  = models.BooleanField(default=True)
    booking_confirmed_email  = models.BooleanField(default=True)
    booking_declined_email   = models.BooleanField(default=True)
    booking_cancelled_email  = models.BooleanField(default=True)
    booking_completed_email  = models.BooleanField(default=True)

    # Payments
    payment_received_email   = models.BooleanField(default=True)
    payment_failed_email     = models.BooleanField(default=True)
    payment_refunded_email   = models.BooleanField(default=True)

    # Messaging
    new_message_email        = models.BooleanField(default=True)

    # Listings
    price_changed_email      = models.BooleanField(default=True)
    listing_available_email  = models.BooleanField(default=True)
    search_alert_email       = models.BooleanField(default=True)
    new_review_email         = models.BooleanField(default=True)

    # Reports
    report_submitted_email   = models.BooleanField(default=True)  # admins
    report_updated_email     = models.BooleanField(default=True)  # reporters
    # Account actions
    account_suspended_email  = models.BooleanField(default=True)
    account_reinstated_email = models.BooleanField(default=True)

    # Account security
    phone_number_changed_email = models.BooleanField(default=True)

    # Master switch — set False to silence ALL in-app notifications
    in_app_enabled = models.BooleanField(default=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.user.username} - notification preferences'

    def email_enabled_for(self, notification_type: str) -> bool:
        field_name = f'{notification_type}_email'
        return getattr(self, field_name, True)


class DeviceToken(models.Model):
    """Stores a Web Push subscription for a user's browser/device."""
    DEVICE_TYPES = [
        ('web', 'Web Browser'),
        ('android', 'Android'),
        ('ios', 'iOS'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='device_tokens',
    )
    # For Web Push: the subscription endpoint URL
    endpoint = models.TextField()
    # Web Push encryption keys
    p256dh = models.TextField()
    auth = models.TextField()
    device_type = models.CharField(max_length=20, choices=DEVICE_TYPES, default='web')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['user', 'endpoint']

    def __str__(self):
        return f'{self.user.username} ({self.device_type})'
