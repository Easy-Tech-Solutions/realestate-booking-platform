from django.utils import timezone
from rest_framework import serializers
from .models import Suspension


class SuspensionCreateSerializer(serializers.ModelSerializer):
    """Used by admins to issue a new suspension."""

    class Meta:
        model  = Suspension
        fields = [
            'user',
            'suspension_type',
            'reason',
            'ends_at',
            'related_report',
        ]

    def validate(self, attrs):
        suspension_type = attrs.get('suspension_type')
        ends_at         = attrs.get('ends_at')

        if suspension_type == Suspension.SuspensionType.TEMPORARY and not ends_at:
            raise serializers.ValidationError(
                {'ends_at': 'A temporary suspension requires an end date.'}
            )

        if suspension_type in (
            Suspension.SuspensionType.INDEFINITE,
            Suspension.SuspensionType.PERMANENT,
        ) and ends_at:
            raise serializers.ValidationError(
                {'ends_at': 'Indefinite and permanent suspensions must not have an end date.'}
            )

        if ends_at and ends_at <= timezone.now():
            raise serializers.ValidationError(
                {'ends_at': 'End date must be in the future.'}
            )

        return attrs

    def validate_user(self, value):
        if value.is_staff or value.is_superuser:
            raise serializers.ValidationError('Staff and superuser accounts cannot be suspended.')
        # Check for an already-active suspension
        from django.db.models import Q
        already_active = (
            Suspension.objects
            .filter(user=value, status=Suspension.Status.ACTIVE)
            .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now()))
            .exists()
        )
        if already_active:
            raise serializers.ValidationError(
                'This user already has an active suspension. Revoke it first.'
            )
        return value


class SuspensionSerializer(serializers.ModelSerializer):
    """Full read representation — returned to admins."""
    username = serializers.CharField(source='user.username', read_only=True)
    issued_by_username = serializers.SerializerMethodField()
    revoked_by_username = serializers.SerializerMethodField()
    suspension_type_display = serializers.CharField(source='get_suspension_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    is_currently_active = serializers.BooleanField(read_only=True)
    related_report_id = serializers.IntegerField(source='related_report.id', read_only=True, default=None)

    class Meta:
        model  = Suspension
        fields = [
            'id',
            'user', 'username',
            'issued_by', 'issued_by_username',
            'suspension_type', 'suspension_type_display',
            'reason',
            'started_at', 'ends_at',
            'status', 'status_display',
            'is_currently_active',
            'revoked_by', 'revoked_by_username',
            'revoked_at', 'revocation_reason',
            'related_report_id',
            'user_notified',
            'updated_at',
        ]
        read_only_fields = fields

    def get_issued_by_username(self, obj):
        return obj.issued_by.username if obj.issued_by else None

    def get_revoked_by_username(self, obj):
        return obj.revoked_by.username if obj.revoked_by else None


class SuspensionRevokeSerializer(serializers.Serializer):
    """Body for the revoke endpoint."""
    revocation_reason = serializers.CharField(required=False, allow_blank=True, default='')
