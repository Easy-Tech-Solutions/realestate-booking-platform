from django.contrib import admin
from django.utils import timezone
from django.utils.html import format_html
from .models import Report


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display  = [
        'id', 'reporter_link', 'content_type', 'report_type',
        'colored_status', 'created_at', 'resolved_by',
    ]
    list_filter   = ['status', 'report_type', 'content_type', 'created_at']
    search_fields = ['reporter__username', 'description', 'admin_notes']
    readonly_fields = [
        'reporter', 'content_type',
        'reported_user', 'reported_listing', 'reported_review', 'reported_message',
        'report_type', 'description',
        'created_at', 'updated_at', 'resolved_at', 'resolved_by',
    ]
    fieldsets = (
        ('Report Details', {
            'fields': (
                'reporter',
                ('content_type', 'report_type'),
                'reported_user', 'reported_listing', 'reported_review', 'reported_message',
                'description',
            )
        }),
        ('Admin Workflow', {
            'fields': ('status', 'admin_notes', 'resolved_by', 'resolved_at'),
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )

    def save_model(self, request, obj, form, change):
        """
        When an admin changes the status to resolved or dismissed through the
        admin form, automatically stamp resolved_by and resolved_at so those
        fields are never left blank.
        """
        if change:
            original_status = Report.objects.filter(pk=obj.pk).values_list('status', flat=True).first()
            terminal = {Report.Status.RESOLVED, Report.Status.DISMISSED}

            if obj.status in terminal and original_status not in terminal:
                # Status is transitioning into a terminal state — stamp the fields
                obj.resolved_by = request.user
                obj.resolved_at = timezone.now()
            elif obj.status not in terminal:
                # Status moved back out of terminal (e.g. re-opened) — clear the fields
                obj.resolved_by = None
                obj.resolved_at = None

        super().save_model(request, obj, form, change)

    def reporter_link(self, obj):
        return format_html('<a href="/admin/users/user/{}/change/">{}</a>', obj.reporter_id, obj.reporter.username)
    reporter_link.short_description = 'Reporter'

    def colored_status(self, obj):
        colors = {
            'pending':      '#f59e0b',
            'under_review': '#3b82f6',
            'resolved':     '#10b981',
            'dismissed':    '#6b7280',
        }
        color = colors.get(obj.status, '#000')
        return format_html(
            '<span style="color:{}; font-weight:bold;">{}</span>',
            color, obj.get_status_display()
        )
    colored_status.short_description = 'Status'
