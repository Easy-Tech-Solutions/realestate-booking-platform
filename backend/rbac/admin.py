from django.contrib import admin

from .models import Role, RolePermission, UserRoleAssignment, BreakGlassSession, PendingApproval


class RolePermissionInline(admin.TabularInline):
    model = RolePermission
    extra = 1


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'is_preset', 'created_by', 'updated_at']
    list_filter = ['is_preset']
    search_fields = ['name', 'slug', 'description']
    inlines = [RolePermissionInline]


@admin.register(UserRoleAssignment)
class UserRoleAssignmentAdmin(admin.ModelAdmin):
    list_display = ['user', 'role', 'granted_by', 'granted_at']
    search_fields = ['user__username', 'role__slug']


@admin.register(BreakGlassSession)
class BreakGlassSessionAdmin(admin.ModelAdmin):
    list_display = ['user', 'granted_at', 'expires_at', 'revoked_at']
    readonly_fields = ['user', 'reason', 'granted_at', 'expires_at']

    def has_add_permission(self, request):
        return False


@admin.register(PendingApproval)
class PendingApprovalAdmin(admin.ModelAdmin):
    list_display = ['action_key', 'requested_by', 'status', 'decided_by', 'created_at']
    list_filter = ['status', 'action_key']
    readonly_fields = ['action_key', 'payload', 'requested_by', 'request_reason', 'created_at']

    def has_add_permission(self, request):
        return False
