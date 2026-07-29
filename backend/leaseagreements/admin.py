from django.contrib import admin
from django.utils.html import format_html

from .models import LeaseAgreement, LeaseAcceptance


@admin.register(LeaseAgreement)
class LeaseAgreementAdmin(admin.ModelAdmin):
    list_display  = ['id', 'booking', 'version', 'tenant_name', 'landlord_name', 'is_accepted', 'generated_at']
    list_filter   = ['version', 'generated_at']
    search_fields = ['booking__id', 'tenant_name', 'landlord_name', 'property_address']
    readonly_fields = [f.name for f in LeaseAgreement._meta.fields] + ['document_link', 'is_accepted']

    def has_add_permission(self, request):
        return False

    @admin.display(description='Document')
    def document_link(self, obj):
        if not obj.document:
            return '—'
        return format_html('<a href="{}" target="_blank">Download lease PDF</a>', obj.document.url)

    @admin.display(boolean=True, description='Accepted')
    def is_accepted(self, obj):
        return obj.is_accepted


@admin.register(LeaseAcceptance)
class LeaseAcceptanceAdmin(admin.ModelAdmin):
    list_display  = ['id', 'user', 'booking', 'version', 'accepted_at', 'ip_address']
    list_filter   = ['version', 'accepted_at']
    search_fields = ['user__username', 'user__email', 'booking__id', 'ip_address']
    readonly_fields = ['user', 'booking', 'version', 'accepted_at', 'ip_address']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser
