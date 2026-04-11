from django.contrib import admin
from django.utils import timezone
from django.utils.html import format_html
from .models import Suspension


@admin.register(Suspension)
class SuspensionAdmin(admin.ModelAdmin):
    list_display  = [
        'id', 'user_link', 'suspension_type', 'colored_status',
        'started_at', 'ends_at', 'issued_by',
    ]
    list_filter   = ['status', 'suspension_type', 'started_at']
    search_fields = ['user__username', 'reason', 'revocation_reason']

    def get_readonly_fields(self, request, obj=None):
        # When editing an existing record, lock down the core fields
        if obj:
            return [
                'user', 'issued_by', 'suspension_type', 'reason',
                'started_at', 'related_report', 'user_notified',
                'revoked_by', 'revoked_at', 'updated_at',
            ]
        return ['issued_by', 'started_at', 'revoked_by', 'revoked_at', 'user_notified', 'updated_at']

    fieldsets = (
        ('Suspension Details', {
            'fields': (
                'user',
                ('suspension_type', 'status'),
                'reason',
                ('started_at', 'ends_at'),
                'related_report',
            )
        }),
        ('Revocation', {
            'fields': ('revoked_by', 'revoked_at', 'revocation_reason'),
            'classes': ('collapse',),
        }),
        ('Meta', {
            'fields': ('issued_by', 'user_notified', 'updated_at'),
            'classes': ('collapse',),
        }),
    )

    def save_model(self, request, obj, form, change):
        if not change:
            # New suspension — record the issuing admin
            obj.issued_by = request.user

        if change:
            original = Suspension.objects.filter(pk=obj.pk).values_list('status', flat=True).first()
            terminal = {Suspension.Status.REVOKED}
            if obj.status in terminal and original not in terminal:
                obj.revoked_by = request.user
                obj.revoked_at = timezone.now()

        super().save_model(request, obj, form, change)

        # Trigger notifications after a new suspension is saved via admin
        if not change:
            try:
                from notifications.services import notify_account_suspended
                notify_account_suspended(obj)
                obj.user_notified = True
                obj.save(update_fields=['user_notified'])
            except Exception:
                pass
        elif obj.status == Suspension.Status.REVOKED:
            try:
                from notifications.services import notify_account_reinstated
                notify_account_reinstated(obj)
            except Exception:
                pass

    def user_link(self, obj):
        return format_html(
            '<a href="/admin/users/user/{}/change/">{}</a>',
            obj.user_id, obj.user.username,
        )
    user_link.short_description = 'User'

    def colored_status(self, obj):
        colors = {
            'active':  '#ef4444',
            'expired': '#6b7280',
            'revoked': '#10b981',
        }
        color = colors.get(obj.status, '#000')
        return format_html(
            '<span style="color:{}; font-weight:bold;">{}</span>',
            color, obj.get_status_display(),
        )
    colored_status.short_description = 'Status'
