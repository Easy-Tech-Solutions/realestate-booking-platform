from django.contrib import admin
from .models import Notification, NotificationPreference


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display  = ['user', 'notification_type', 'title', 'is_read', 'email_sent', 'created_at']
    list_filter   = ['notification_type', 'is_read', 'email_sent', 'created_at']
    search_fields = ['user__username', 'user__email', 'title', 'message']
    readonly_fields = ['created_at', 'read_at']
    ordering      = ['-created_at']


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display  = ['user', 'in_app_enabled', 'new_message_email', 'booking_confirmed_email', 'updated_at']
    search_fields = ['user__username', 'user__email']
