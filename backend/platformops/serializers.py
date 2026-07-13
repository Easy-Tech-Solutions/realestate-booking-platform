from rest_framework import serializers

from .models import FeatureFlag, TaskHeartbeat


class FeatureFlagSerializer(serializers.ModelSerializer):
    updated_by_username = serializers.CharField(source='updated_by.username', default=None, read_only=True)

    class Meta:
        model = FeatureFlag
        fields = ['id', 'key', 'name', 'description', 'is_enabled', 'updated_by', 'updated_by_username', 'updated_at', 'created_at']
        read_only_fields = ['id', 'updated_by', 'updated_by_username', 'updated_at', 'created_at']

    def validate_key(self, value):
        return value.strip().lower().replace(' ', '_')


class TaskHeartbeatSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskHeartbeat
        fields = ['id', 'task_name', 'last_run_at', 'last_success', 'last_error', 'run_count']
        read_only_fields = fields
