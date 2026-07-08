from django import forms
from django.contrib import admin, messages
from django.utils.html import format_html

from .models import HostApplication, AgreementAcceptance
from .services import (
    ps_decision, compliance_decision, supervisor_decision, InvalidTransition,
)


# Which Django permission gates each review stage, and which service handles it.
STAGE_CONFIG = {
    HostApplication.Stage.PRODUCT_SUPPORT: (
        'hostapplications.review_product_support', ps_decision,
    ),
    HostApplication.Stage.COMPLIANCE: (
        'hostapplications.review_compliance', compliance_decision,
    ),
    HostApplication.Stage.SUPERVISOR: (
        'hostapplications.review_supervisor', supervisor_decision,
    ),
}


class HostApplicationAdminForm(forms.ModelForm):
    """Adds a transient approve/decline control to the change form."""

    DECISION_CHOICES = [
        ('',        '— No change —'),
        ('approve', 'Approve → advance to next stage'),
        ('decline', 'Decline this application'),
    ]
    decision = forms.ChoiceField(
        choices=DECISION_CHOICES,
        required=False,
        label='Decision',
        help_text='Approving advances to the next stage; the final approval activates the host.',
    )

    class Meta:
        model = HostApplication
        fields = ['decline_reason']

    def clean(self):
        cleaned = super().clean()
        if cleaned.get('decision') == 'decline' and not (cleaned.get('decline_reason') or '').strip():
            self.add_error('decline_reason', 'A reason is required when declining — it is emailed to the applicant.')
        return cleaned


@admin.register(HostApplication)
class HostApplicationAdmin(admin.ModelAdmin):
    form = HostApplicationAdminForm

    list_display  = ['id', 'applicant', 'full_name', 'colored_status', 'current_stage_display', 'created_at']
    list_filter   = ['status', 'created_at']
    search_fields = ['applicant__username', 'applicant__email', 'full_name', 'phone']
    date_hierarchy = 'created_at'

    readonly_fields = [
        'applicant', 'full_name', 'address', 'phone', 'email_display',
        'headshot_preview', 'id_document_preview',
        'status', 'current_stage_display',
        'ps_reviewed_by', 'ps_reviewed_at',
        'compliance_reviewed_by', 'compliance_reviewed_at',
        'supervisor_reviewed_by', 'supervisor_reviewed_at',
        'declined_stage', 'created_at', 'updated_at',
    ]
    fieldsets = (
        ('Applicant', {
            'fields': ('applicant', 'email_display', 'full_name', 'address', 'phone'),
        }),
        ('Documents', {
            'fields': ('headshot_preview', 'id_document_preview'),
        }),
        ('Review status', {
            'fields': (
                'status', 'current_stage_display',
                ('ps_reviewed_by', 'ps_reviewed_at'),
                ('compliance_reviewed_by', 'compliance_reviewed_at'),
                ('supervisor_reviewed_by', 'supervisor_reviewed_at'),
            ),
        }),
        ('Decision', {
            'fields': ('decision', 'decline_reason', 'declined_stage'),
            'description': 'Choose Approve or Decline, then Save. You can only act on applications at your stage.',
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',),
        }),
    )

    # ---- Visibility & permissions -------------------------------------------

    def get_queryset(self, request):
        """Each officer sees only applications waiting on their stage; superusers see all."""
        qs = super().get_queryset(request).select_related('applicant')
        if request.user.is_superuser:
            return qs

        status_for_perm = {
            'hostapplications.review_product_support': HostApplication.Status.SUBMITTED,
            'hostapplications.review_compliance':      HostApplication.Status.PS_APPROVED,
            'hostapplications.review_supervisor':      HostApplication.Status.COMPLIANCE_APPROVED,
        }
        allowed = [s for perm, s in status_for_perm.items() if request.user.has_perm(perm)]
        return qs.filter(status__in=allowed) if allowed else qs.none()

    def has_add_permission(self, request):
        # Applications are created by users through the API, never in the admin.
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    # ---- Decision handling --------------------------------------------------

    def save_model(self, request, obj, form, change):
        decision = form.cleaned_data.get('decision')
        if decision not in ('approve', 'decline'):
            return super().save_model(request, obj, form, change)

        stage = obj.current_stage
        config = STAGE_CONFIG.get(stage)
        if config is None:
            messages.error(request, 'This application is not awaiting review.')
            return

        perm, handler = config
        if not request.user.has_perm(perm):
            messages.error(request, 'You do not have permission to act on this stage.')
            return

        approve = decision == 'approve'
        reason = form.cleaned_data.get('decline_reason', '')
        try:
            handler(obj, approve, request.user, reason)
        except InvalidTransition as exc:
            messages.error(request, str(exc))
            return

        verb = 'approved and advanced' if approve else 'declined'
        messages.success(request, f'Application #{obj.pk} {verb}.')

    # ---- Display helpers ----------------------------------------------------

    @admin.display(description='Email')
    def email_display(self, obj):
        return obj.applicant.email

    @admin.display(description='Current stage')
    def current_stage_display(self, obj):
        stage = obj.current_stage
        return stage.label if stage else '— (closed)'

    def _img(self, image, label):
        if not image:
            return '—'
        return format_html(
            '<a href="{0}" target="_blank"><img src="{0}" alt="{1}" '
            'style="max-height:200px;border-radius:6px;border:1px solid #ddd;" /></a>',
            image.url, label,
        )

    @admin.display(description='Headshot')
    def headshot_preview(self, obj):
        return self._img(obj.headshot, 'Headshot')

    @admin.display(description='ID / Passport')
    def id_document_preview(self, obj):
        return self._img(obj.id_document, 'ID document')

    @admin.display(description='Status')
    def colored_status(self, obj):
        colors = {
            'submitted':           '#f59e0b',
            'ps_approved':         '#3b82f6',
            'compliance_approved': '#6366f1',
            'approved':            '#10b981',
            'declined':            '#ef4444',
        }
        return format_html(
            '<span style="color:{}; font-weight:bold;">{}</span>',
            colors.get(obj.status, '#000'), obj.get_status_display(),
        )


@admin.register(AgreementAcceptance)
class AgreementAcceptanceAdmin(admin.ModelAdmin):
    """Read-only audit log of agreement acceptances."""
    list_display  = ['id', 'user', 'agreement', 'version', 'accepted_at', 'ip_address']
    list_filter   = ['agreement', 'version', 'accepted_at']
    search_fields = ['user__username', 'user__email', 'version', 'ip_address']
    readonly_fields = ['user', 'agreement', 'version', 'accepted_at', 'ip_address']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser
