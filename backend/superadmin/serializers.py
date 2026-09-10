from rest_framework import serializers

from .models import AdminAuditLog, ImpersonationSession, StaffProfile, StaffEducation, StaffLegalRecord


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


class StaffEducationSerializer(serializers.ModelSerializer):
    class Meta:
        model = StaffEducation
        fields = [
            'id', 'institution', 'degree', 'field_of_study',
            'start_year', 'end_year', 'description', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class StaffLegalRecordSerializer(serializers.ModelSerializer):
    document_url = serializers.SerializerMethodField()

    class Meta:
        model = StaffLegalRecord
        fields = [
            'id', 'record_type', 'title', 'issuing_authority', 'document_number',
            'issue_date', 'expiry_date', 'document', 'document_url', 'notes', 'created_at',
        ]
        read_only_fields = ['id', 'document_url', 'created_at']
        extra_kwargs = {'document': {'write_only': True, 'required': False}}

    def get_document_url(self, obj):
        return obj.document.url if obj.document else None


class StaffProfileSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    email = serializers.CharField(source='user.email', read_only=True)
    username = serializers.CharField(source='user.username', read_only=True)
    onboarded_by_username = serializers.CharField(source='onboarded_by.username', default=None, read_only=True)
    education = StaffEducationSerializer(many=True, read_only=True)
    legal_records = StaffLegalRecordSerializer(many=True, read_only=True)

    class Meta:
        model = StaffProfile
        fields = [
            'id', 'user', 'full_name', 'email', 'username', 'position', 'department',
            'hire_date', 'phone_number', 'bio', 'is_active', 'onboarded_by_username',
            'education', 'legal_records', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'user', 'full_name', 'email', 'username',
                            'onboarded_by_username', 'education', 'legal_records',
                            'created_at', 'updated_at']

    def get_full_name(self, obj):
        return obj.user.get_full_name() or obj.user.username
