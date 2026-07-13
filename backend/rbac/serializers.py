from rest_framework import serializers

from .models import Role, RolePermission, UserRoleAssignment, BreakGlassSession, PendingApproval
from .resources import ACTIONS, is_valid_resource


class RolePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RolePermission
        fields = ['id', 'resource', 'action']
        read_only_fields = ['id']

    def validate_resource(self, value):
        if not is_valid_resource(value):
            raise serializers.ValidationError(f'"{value}" is not a known resource path.')
        return value

    def validate_action(self, value):
        if value not in ACTIONS:
            raise serializers.ValidationError(f'Action must be one of: {", ".join(ACTIONS)}.')
        return value


class RoleSerializer(serializers.ModelSerializer):
    permissions = RolePermissionSerializer(many=True, read_only=True)
    created_by_username = serializers.CharField(source='created_by.username', default=None, read_only=True)
    assignee_count = serializers.SerializerMethodField()

    class Meta:
        model = Role
        fields = [
            'id', 'name', 'slug', 'description', 'is_preset',
            'created_by', 'created_by_username', 'permissions', 'assignee_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'is_preset', 'created_by', 'created_by_username', 'permissions', 'assignee_count', 'created_at', 'updated_at']

    def get_assignee_count(self, obj):
        return obj.assignments.count()


class UserRoleAssignmentSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    role_name = serializers.CharField(source='role.name', read_only=True)
    role_slug = serializers.CharField(source='role.slug', read_only=True)
    granted_by_username = serializers.CharField(source='granted_by.username', default=None, read_only=True)

    class Meta:
        model = UserRoleAssignment
        fields = ['id', 'user', 'username', 'role', 'role_name', 'role_slug', 'granted_by', 'granted_by_username', 'granted_at']
        read_only_fields = ['id', 'username', 'role_name', 'role_slug', 'granted_by', 'granted_by_username', 'granted_at']


class BreakGlassSessionSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source='user.username', read_only=True)
    revoked_by_username = serializers.CharField(source='revoked_by.username', default=None, read_only=True)
    is_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = BreakGlassSession
        fields = ['id', 'user', 'username', 'reason', 'granted_at', 'expires_at', 'revoked_at', 'revoked_by', 'revoked_by_username', 'is_active']
        read_only_fields = fields


class PendingApprovalSerializer(serializers.ModelSerializer):
    requested_by_username = serializers.CharField(source='requested_by.username', read_only=True)
    decided_by_username = serializers.CharField(source='decided_by.username', default=None, read_only=True)

    class Meta:
        model = PendingApproval
        fields = [
            'id', 'action_key', 'payload', 'request_reason', 'requested_by', 'requested_by_username',
            'status', 'decided_by', 'decided_by_username', 'decision_reason', 'decided_at',
            'execution_result', 'execution_error', 'created_at',
        ]
        read_only_fields = fields
