from rest_framework import serializers
from .models import Notification, NotificationPreference


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Notification
        fields = [
            'id',
            'notification_type',
            'title',
            'message',
            'data',
            'is_read',
            'email_sent',
            'created_at',
            'read_at',
        ]
        read_only_fields = fields


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model  = NotificationPreference
        fields = [
            # Booking
            'booking_requested_email',
            'booking_confirmed_email',
            'booking_declined_email',
            'booking_cancelled_email',
            'booking_completed_email',
            # Payments
            'payment_received_email',
            'payment_failed_email',
            'payment_refunded_email',
            # Messaging
            'new_message_email',
            # Listings
            'price_changed_email',
            'listing_available_email',
            'search_alert_email',
            'new_review_email',
            # Master switch
            'in_app_enabled',
            'updated_at',
        ]
        read_only_fields = ['updated_at']
