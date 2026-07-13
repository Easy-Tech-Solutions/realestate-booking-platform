from rest_framework import serializers

from .models import AdminAuditLog, ImpersonationSession


class AdminAuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source='actor.username', default=None, read_only=True)
    actor_email = serializers.CharField(source='actor.email', default=None, read_only=True)

    class Meta:
        model = AdminAuditLog
        fields = [
            'id', 'actor', 'actor_username', 'actor_email', 'action',
            'target_type', 'target_id', 'target_repr', 'reason',
            'ip_address', 'user_agent', 'metadata', 'created_at',
        ]
        read_only_fields = fields


class ImpersonationSessionSerializer(serializers.ModelSerializer):
    admin_username = serializers.CharField(source='admin.username', read_only=True)
    target_username = serializers.CharField(source='target.username', read_only=True)

    class Meta:
        model = ImpersonationSession
        fields = [
            'id', 'admin', 'admin_username', 'target', 'target_username',
            'reason', 'started_at', 'ended_at', 'ip_address',
        ]
        read_only_fields = fields
