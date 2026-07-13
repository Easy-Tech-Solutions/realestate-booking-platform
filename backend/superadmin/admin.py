from django.contrib import admin

from .models import AdminAuditLog, ImpersonationSession, MFADevice


@admin.register(AdminAuditLog)
class AdminAuditLogAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'actor', 'action', 'target_type', 'target_repr', 'ip_address']
    list_filter = ['action', 'target_type']
    search_fields = ['actor__username', 'actor__email', 'target_repr', 'reason']
    readonly_fields = [f.name for f in AdminAuditLog._meta.fields]
    ordering = ['-created_at']

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(MFADevice)
class MFADeviceAdmin(admin.ModelAdmin):
    list_display = ['user', 'confirmed', 'created_at', 'confirmed_at']
    search_fields = ['user__username', 'user__email']
    readonly_fields = ['secret', 'backup_codes', 'created_at', 'confirmed_at']


@admin.register(ImpersonationSession)
class ImpersonationSessionAdmin(admin.ModelAdmin):
    list_display = ['admin', 'target', 'started_at', 'ended_at', 'ip_address']
    search_fields = ['admin__username', 'target__username']
    readonly_fields = [f.name for f in ImpersonationSession._meta.fields]

    def has_add_permission(self, request):
        return False
