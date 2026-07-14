from rest_framework import serializers

from .models import HostApplication


class HostApplicationCreateSerializer(serializers.ModelSerializer):
    """Used by an authenticated user to submit a host application."""

    # Not a model field — the applicant must tick the Property Owner Agreement
    # checkbox. Acceptance itself is recorded server-side (with version/IP) in
    # the view so the client can't spoof the version.
    agreement_accepted = serializers.BooleanField(write_only=True)

    class Meta:
        model = HostApplication
        fields = ['full_name', 'address', 'phone', 'headshot', 'id_document', 'agreement_accepted']

    def validate_agreement_accepted(self, value):
        if not value:
            raise serializers.ValidationError(
                'You must agree to the Property Owner Agreement to apply.'
            )
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and HostApplication.objects.filter(
            applicant=user, status__in=HostApplication.ACTIVE_STATUSES,
        ).exists():
            raise serializers.ValidationError(
                'You already have an application under review.'
            )
        # Drop the non-model flag before .save() creates the HostApplication.
        attrs.pop('agreement_accepted', None)
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


class HostApplicationAdminSerializer(HostApplicationSerializer):
    """Adds the AI pre-screen fields — reviewer-only, never returned to the
    applicant being assessed (see HostApplicationSerializer for that view)."""

    class Meta(HostApplicationSerializer.Meta):
        fields = HostApplicationSerializer.Meta.fields + ['ai_risk_score', 'ai_rationale']
        read_only_fields = fields
