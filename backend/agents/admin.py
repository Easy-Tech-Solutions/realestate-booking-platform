from django import forms
from django.contrib import admin, messages
from django.utils.html import format_html

from django.utils import timezone

from .models import AgentApplication, AgentProfile, AgentCommission
from .services import ps_decision, compliance_decision, supervisor_decision, InvalidTransition


STAGE_CONFIG = {
    AgentApplication.Stage.PRODUCT_SUPPORT: ('agents.review_agent_product_support', ps_decision),
    AgentApplication.Stage.COMPLIANCE:      ('agents.review_agent_compliance', compliance_decision),
    AgentApplication.Stage.SUPERVISOR:      ('agents.review_agent_supervisor', supervisor_decision),
}


class AgentApplicationAdminForm(forms.ModelForm):
    DECISION_CHOICES = [
        ('',        '— No change —'),
        ('approve', 'Approve → advance to next stage'),
        ('decline', 'Decline this application'),
    ]
    decision = forms.ChoiceField(choices=DECISION_CHOICES, required=False, label='Decision')

    class Meta:
        model = AgentApplication
        fields = ['decline_reason']

    def clean(self):
        cleaned = super().clean()
        if cleaned.get('decision') == 'decline' and not (cleaned.get('decline_reason') or '').strip():
            self.add_error('decline_reason', 'A reason is required when declining — it is emailed to the applicant.')
        return cleaned


@admin.register(AgentApplication)
class AgentApplicationAdmin(admin.ModelAdmin):
    form = AgentApplicationAdminForm

    list_display  = ['id', 'applicant', 'full_name', 'colored_status', 'current_stage_display', 'created_at']
    list_filter   = ['status', 'created_at']
    search_fields = ['applicant__username', 'applicant__email', 'full_name', 'phone']
    date_hierarchy = 'created_at'

    readonly_fields = [
        'applicant', 'full_name', 'address', 'phone', 'email_display', 'id_document_preview',
        'agreement_version', 'agreement_accepted_at',
        'status', 'current_stage_display',
        'ps_reviewed_by', 'ps_reviewed_at',
        'compliance_reviewed_by', 'compliance_reviewed_at',
        'supervisor_reviewed_by', 'supervisor_reviewed_at',
        'declined_stage', 'created_at', 'updated_at',
    ]
    fieldsets = (
        ('Applicant', {'fields': ('applicant', 'email_display', 'full_name', 'address', 'phone')}),
        ('Documents & agreement', {'fields': ('id_document_preview', 'agreement_version', 'agreement_accepted_at')}),
        ('Review status', {'fields': (
            'status', 'current_stage_display',
            ('ps_reviewed_by', 'ps_reviewed_at'),
            ('compliance_reviewed_by', 'compliance_reviewed_at'),
            ('supervisor_reviewed_by', 'supervisor_reviewed_at'),
        )}),
        ('Decision', {'fields': ('decision', 'decline_reason', 'declined_stage')}),
        ('Timestamps', {'fields': ('created_at', 'updated_at'), 'classes': ('collapse',)}),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request).select_related('applicant')
        if request.user.is_superuser:
            return qs
        status_for_perm = {
            'agents.review_agent_product_support': AgentApplication.Status.SUBMITTED,
            'agents.review_agent_compliance':      AgentApplication.Status.PS_APPROVED,
            'agents.review_agent_supervisor':      AgentApplication.Status.COMPLIANCE_APPROVED,
        }
        allowed = [s for perm, s in status_for_perm.items() if request.user.has_perm(perm)]
        return qs.filter(status__in=allowed) if allowed else qs.none()

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

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
        messages.success(request, f'Agent application #{obj.pk} {"approved and advanced" if approve else "declined"}.')

    @admin.display(description='Email')
    def email_display(self, obj):
        return obj.applicant.email

    @admin.display(description='Current stage')
    def current_stage_display(self, obj):
        stage = obj.current_stage
        return stage.label if stage else '— (closed)'

    @admin.display(description='ID / Passport')
    def id_document_preview(self, obj):
        if not obj.id_document:
            return '—'
        return format_html('<a href="{0}" target="_blank"><img src="{0}" style="max-height:200px;border-radius:6px;border:1px solid #ddd;"/></a>', obj.id_document.url)

    @admin.display(description='Status')
    def colored_status(self, obj):
        colors = {'submitted': '#f59e0b', 'ps_approved': '#3b82f6', 'compliance_approved': '#6366f1',
                  'approved': '#10b981', 'declined': '#ef4444'}
        return format_html('<span style="color:{}; font-weight:bold;">{}</span>',
                           colors.get(obj.status, '#000'), obj.get_status_display())


@admin.register(AgentProfile)
class AgentProfileAdmin(admin.ModelAdmin):
    list_display  = ['id', 'user', 'is_active', 'approved_at']
    list_filter   = ['is_active']
    search_fields = ['user__username', 'user__email']
    readonly_fields = ['user', 'approved_at', 'application']


@admin.register(AgentCommission)
class AgentCommissionAdmin(admin.ModelAdmin):
    list_display  = ['id', 'agent', 'listing', 'amount', 'currency', 'colored_status', 'created_at']
    list_filter   = ['status', 'currency', 'created_at']
    search_fields = ['agent__username', 'agent__email', 'listing__title', 'reference']
    readonly_fields = ['booking', 'agent', 'listing', 'booking_amount', 'amount', 'currency',
                       'paid_at', 'paid_by', 'voided_at', 'created_at', 'updated_at']
    fields = readonly_fields + ['status', 'reference', 'notes']
    actions = ['mark_paid']

    @admin.action(description='Mark selected commissions as PAID')
    def mark_paid(self, request, queryset):
        from notifications.services import notify_agent_commission_paid
        paid = 0
        for c in queryset.filter(status=AgentCommission.Status.PENDING):
            c.status = AgentCommission.Status.PAID
            c.paid_at = timezone.now()
            c.paid_by = request.user
            c.save(update_fields=['status', 'paid_at', 'paid_by', 'updated_at'])
            try:
                notify_agent_commission_paid(c)
            except Exception:
                pass
            paid += 1
        self.message_user(request, f'{paid} commission(s) marked paid.')

    @admin.display(description='Status')
    def colored_status(self, obj):
        colors = {'pending': '#f59e0b', 'paid': '#10b981', 'voided': '#6b7280'}
        return format_html('<span style="color:{}; font-weight:bold;">{}</span>',
                           colors.get(obj.status, '#000'), obj.get_status_display())
