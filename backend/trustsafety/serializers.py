from rest_framework import serializers

from .models import BlacklistedLocation, BlockedFingerprint, FraudFlag


class FraudFlagSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', default=None, read_only=True)
    user_email = serializers.CharField(source='user.email', default=None, read_only=True)
    flag_type_display = serializers.CharField(source='get_flag_type_display', read_only=True)
    reviewed_by_username = serializers.CharField(source='reviewed_by.username', default=None, read_only=True)

    class Meta:
        model = FraudFlag
        fields = [
            'id', 'user', 'user_username', 'user_email', 'flag_type', 'flag_type_display',
            'severity', 'status', 'details', 'ai_score', 'ai_rationale',
            'reviewed_by', 'reviewed_by_username', 'reviewed_at', 'review_notes',
            'created_at',
        ]
        read_only_fields = [
            'id', 'user', 'user_username', 'user_email', 'flag_type', 'flag_type_display',
            'ai_score', 'ai_rationale', 'reviewed_by', 'reviewed_by_username', 'reviewed_at', 'created_at',
        ]


class BlockedFingerprintSerializer(serializers.ModelSerializer):
    blocked_by_username = serializers.CharField(source='blocked_by.username', default=None, read_only=True)

    class Meta:
        model = BlockedFingerprint
        fields = ['id', 'fingerprint', 'reason', 'blocked_by', 'blocked_by_username', 'created_at']
        read_only_fields = ['id', 'blocked_by', 'blocked_by_username', 'created_at']


class BlacklistedLocationSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source='created_by.username', default=None, read_only=True)

    class Meta:
        model = BlacklistedLocation
        fields = [
            'id', 'name', 'latitude', 'longitude', 'radius_km', 'reason',
            'created_by', 'created_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_by_username', 'created_at']
