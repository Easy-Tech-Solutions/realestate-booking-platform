from rest_framework import serializers

from .models import HostApplication


class HostApplicationCreateSerializer(serializers.ModelSerializer):
    """Used by an authenticated user to submit a host application."""

    class Meta:
        model = HostApplication
        fields = ['full_name', 'address', 'phone', 'headshot', 'id_document']

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and HostApplication.objects.filter(
            applicant=user, status__in=HostApplication.ACTIVE_STATUSES,
        ).exists():
            raise serializers.ValidationError(
                'You already have an application under review.'
            )
        return attrs


class HostApplicationSerializer(serializers.ModelSerializer):
    """Read serializer returned to the applicant (status / re-apply UI)."""

    status_display    = serializers.CharField(source='get_status_display', read_only=True)
    current_stage     = serializers.SerializerMethodField()
    headshot_url      = serializers.SerializerMethodField()
    id_document_url   = serializers.SerializerMethodField()
    can_reapply       = serializers.SerializerMethodField()
    email             = serializers.EmailField(source='applicant.email', read_only=True)

    class Meta:
        model = HostApplication
        fields = [
            'id', 'full_name', 'address', 'phone', 'email',
            'headshot_url', 'id_document_url',
            'status', 'status_display', 'current_stage',
            'declined_stage', 'decline_reason', 'can_reapply',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_current_stage(self, obj):
        return obj.current_stage or None

    def _abs_url(self, image):
        if not image:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(image.url) if request else image.url

    def get_headshot_url(self, obj):
        return self._abs_url(obj.headshot)

    def get_id_document_url(self, obj):
        return self._abs_url(obj.id_document)

    def get_can_reapply(self, obj):
        return obj.status == HostApplication.Status.DECLINED
