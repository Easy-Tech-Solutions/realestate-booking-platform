from django.contrib import admin

from .models import FeatureFlag, TaskHeartbeat


@admin.register(FeatureFlag)
class FeatureFlagAdmin(admin.ModelAdmin):
    list_display = ['key', 'name', 'is_enabled', 'updated_by', 'updated_at']
    list_filter = ['is_enabled']
    search_fields = ['key', 'name', 'description']


@admin.register(TaskHeartbeat)
class TaskHeartbeatAdmin(admin.ModelAdmin):
    list_display = ['task_name', 'last_run_at', 'last_success', 'run_count']
    readonly_fields = ['task_name', 'last_run_at', 'last_success', 'last_error', 'run_count']

    def has_add_permission(self, request):
        return False
