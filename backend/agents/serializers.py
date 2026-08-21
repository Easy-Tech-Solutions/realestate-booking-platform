from rest_framework import serializers

from .models import AgentApplication


class AgentApplicationCreateSerializer(serializers.ModelSerializer):
    """Used by an authenticated user to apply to become a sourcing agent."""

    # Not a model field — the applicant must accept the Agent Agreement. Version/
    # timestamp are stamped server-side in the view.
    agreement_accepted = serializers.BooleanField(write_only=True)

    class Meta:
        model = AgentApplication
        fields = ['full_name', 'address', 'phone', 'id_document', 'agreement_accepted']

    def validate_agreement_accepted(self, value):
        if not value:
            raise serializers.ValidationError('You must agree to the Agent Agreement to apply.')
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if user and AgentApplication.objects.filter(
            applicant=user, status__in=AgentApplication.ACTIVE_STATUSES,
        ).exists():
            raise serializers.ValidationError('You already have an agent application under review.')
        attrs.pop('agreement_accepted', None)
        return attrs


class AgentApplicationSerializer(serializers.ModelSerializer):
    """Read serializer returned to the applicant."""

    status_display  = serializers.CharField(source='get_status_display', read_only=True)
    current_stage   = serializers.SerializerMethodField()
    id_document_url = serializers.SerializerMethodField()
    can_reapply     = serializers.SerializerMethodField()
    email           = serializers.EmailField(source='applicant.email', read_only=True)

    class Meta:
        model = AgentApplication
        fields = [
            'id', 'full_name', 'address', 'phone', 'email', 'id_document_url',
            'status', 'status_display', 'current_stage',
            'declined_stage', 'decline_reason', 'can_reapply',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_current_stage(self, obj):
        return obj.current_stage or None

    def get_id_document_url(self, obj):
        if not obj.id_document:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.id_document.url) if request else obj.id_document.url

    def get_can_reapply(self, obj):
        return obj.status == AgentApplication.Status.DECLINED
