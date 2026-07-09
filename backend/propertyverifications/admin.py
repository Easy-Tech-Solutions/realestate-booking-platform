from django import forms
from django.contrib import admin, messages
from django.utils.html import format_html

from .models import PropertyVerification
from .services import (
    ps_decision, compliance_decision, supervisor_decision, InvalidTransition,
    APPROVE, REJECT, REQUEST_CORRECTION,
)


# stage → (permission required, service handler)
STAGE_CONFIG = {
    PropertyVerification.Stage.PRODUCT_SUPPORT: (
        'propertyverifications.review_property_product_support', ps_decision,
    ),
    PropertyVerification.Stage.COMPLIANCE: (
        'propertyverifications.review_property_compliance', compliance_decision,
    ),
    PropertyVerification.Stage.SUPERVISOR: (
        'propertyverifications.review_property_supervisor', supervisor_decision,
    ),
}


class PropertyVerificationAdminForm(forms.ModelForm):
    DECISION_CHOICES = [
        ('',                 '— No change —'),
        (APPROVE,            'Approve → advance / publish'),
        (REQUEST_CORRECTION, 'Request correction (return to host)'),
        (REJECT,             'Reject (terminal)'),
    ]
    decision = forms.ChoiceField(
        choices=DECISION_CHOICES, required=False, label='Decision',
        help_text='Reject and Request-correction require a note (emailed to the host).',
    )

    class Meta:
        model = PropertyVerification
        fields = ['review_notes']

    def clean(self):
        cleaned = super().clean()
        if cleaned.get('decision') in (REJECT, REQUEST_CORRECTION) and not (cleaned.get('review_notes') or '').strip():
            self.add_error('review_notes', 'A note is required when rejecting or requesting a correction.')
        return cleaned


@admin.register(PropertyVerification)
class PropertyVerificationAdmin(admin.ModelAdmin):
    form = PropertyVerificationAdminForm

    list_display  = ['id', 'listing_link', 'applicant', 'ownership_type', 'colored_status', 'current_stage_display', 'created_at']
    list_filter   = ['status', 'ownership_type', 'created_at']
    search_fields = ['listing__title', 'applicant__username', 'applicant__email', 'owner_name', 'deed_volume_number']
    date_hierarchy = 'created_at'

    readonly_fields = [
        'listing_link', 'applicant', 'ownership_type', 'owner_name',
        'property_location', 'deed_volume_number', 'mou_link',
        'status', 'current_stage_display', 'resubmission_count',
        'ps_reviewed_by', 'ps_reviewed_at',
        'compliance_reviewed_by', 'compliance_reviewed_at',
        'supervisor_reviewed_by', 'supervisor_reviewed_at',
        'outcome_stage', 'created_at', 'updated_at',
    ]
    fieldsets = (
        ('Property', {'fields': ('listing_link', 'applicant', 'ownership_type', 'owner_name', 'property_location', 'deed_volume_number', 'mou_link')}),
        ('Review status', {
            'fields': (
                'status', 'current_stage_display', 'resubmission_count', 'outcome_stage',
                ('ps_reviewed_by', 'ps_reviewed_at'),
                ('compliance_reviewed_by', 'compliance_reviewed_at'),
                ('supervisor_reviewed_by', 'supervisor_reviewed_at'),
            ),
        }),
        ('Decision', {
            'fields': ('decision', 'review_notes'),
            'description': 'Choose an action, then Save. You can only act on verifications at your stage.',
        }),
        ('Timestamps', {'fields': ('created_at', 'updated_at'), 'classes': ('collapse',)}),
    )

    # ---- Visibility & permissions -------------------------------------------

    def get_queryset(self, request):
        qs = super().get_queryset(request).select_related('listing', 'applicant')
        if request.user.is_superuser:
            return qs
        status_for_perm = {
            'propertyverifications.review_property_product_support': PropertyVerification.Status.SUBMITTED,
            'propertyverifications.review_property_compliance':      PropertyVerification.Status.PS_APPROVED,
            'propertyverifications.review_property_supervisor':      PropertyVerification.Status.COMPLIANCE_APPROVED,
        }
        allowed = [s for perm, s in status_for_perm.items() if request.user.has_perm(perm)]
        return qs.filter(status__in=allowed) if allowed else qs.none()

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    # ---- Decision handling --------------------------------------------------

    def save_model(self, request, obj, form, change):
        decision = form.cleaned_data.get('decision')
        if decision not in (APPROVE, REJECT, REQUEST_CORRECTION):
            return super().save_model(request, obj, form, change)

        stage = obj.current_stage
        config = STAGE_CONFIG.get(stage)
        if config is None:
            messages.error(request, 'This verification is not awaiting review.')
            return
        perm, handler = config
        if not request.user.has_perm(perm):
            messages.error(request, 'You do not have permission to act on this stage.')
            return

        notes = form.cleaned_data.get('review_notes', '')
        try:
            handler(obj, decision, request.user, notes)
        except InvalidTransition as exc:
            messages.error(request, str(exc))
            return

        verb = {APPROVE: 'approved', REJECT: 'rejected', REQUEST_CORRECTION: 'returned for correction'}[decision]
        messages.success(request, f'Verification #{obj.pk} {verb}.')

    # ---- Display helpers ----------------------------------------------------

    def listing_link(self, obj):
        return format_html('<a href="/admin/listings/listing/{}/change/">{}</a>', obj.listing_id, obj.listing.title)
    listing_link.short_description = 'Listing'

    @admin.display(description='Current stage')
    def current_stage_display(self, obj):
        stage = obj.current_stage
        return stage.label if stage else '— (closed)'

    @admin.display(description='MOU document')
    def mou_link(self, obj):
        if not obj.mou_document:
            return '—'
        return format_html('<a href="{}" target="_blank">View MOU</a>', obj.mou_document.url)

    @admin.display(description='Status')
    def colored_status(self, obj):
        colors = {
            'submitted': '#f59e0b', 'ps_approved': '#3b82f6', 'compliance_approved': '#6366f1',
            'approved': '#10b981', 'rejected': '#ef4444', 'correction_requested': '#d97706',
        }
        return format_html('<span style="color:{}; font-weight:bold;">{}</span>',
                           colors.get(obj.status, '#000'), obj.get_status_display())
