import re

from rest_framework import serializers

from .models import HostApplication


# MTN Liberia MoMo numbers (077/088 prefixes), accepting local, bare, and
# international forms after stripping separators. Mirrors the gateway's
# _validate_liberian_phone — only MTN numbers can be paid out today.
_MTN_MOMO_RE = re.compile(r'^(231)?0?(77|88)\d{7}$')


def validate_mtn_momo_number(value):
    cleaned = re.sub(r'\D', '', value or '')
    if not _MTN_MOMO_RE.match(cleaned):
        raise serializers.ValidationError(
            'Enter a valid MTN Mobile Money number (e.g. 0880123456).'
        )
    return value


class HostApplicationCreateSerializer(serializers.ModelSerializer):
    """Used by an authenticated user to submit a host application."""

    # Not a model field — the applicant must tick the Property Owner Agreement
    # checkbox. Acceptance itself is recorded server-side (with version/IP) in
    # the view so the client can't spoof the version.
    agreement_accepted = serializers.BooleanField(write_only=True)

    class Meta:
        model = HostApplication
        fields = [
            'full_name', 'address', 'momo_number', 'headshot', 'id_document', 'agreement_accepted',
        ]

    def validate_momo_number(self, value):
        # momo_network stays 'mtn' (the model default) — not collected on the
        # form — so the number must be an MTN wallet to be payable.
        return validate_mtn_momo_number(value)

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
    tax_clearance_receipt_url = serializers.SerializerMethodField()
    can_reapply       = serializers.SerializerMethodField()
    email             = serializers.EmailField(source='applicant.email', read_only=True)

    class Meta:
        model = HostApplication
        fields = [
            'id', 'full_name', 'address', 'momo_number', 'momo_network', 'email',
            'headshot_url', 'id_document_url', 'tax_clearance_receipt_url',
            'next_of_kin_name', 'next_of_kin_relationship', 'next_of_kin_phone',
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

    def get_tax_clearance_receipt_url(self, obj):
        return self._abs_url(obj.tax_clearance_receipt)

    def get_can_reapply(self, obj):
        return obj.status == HostApplication.Status.DECLINED


class HostApplicationAdminSerializer(HostApplicationSerializer):
    """Adds the AI pre-screen fields — reviewer-only, never returned to the
    applicant being assessed (see HostApplicationSerializer for that view)."""

    class Meta(HostApplicationSerializer.Meta):
        fields = HostApplicationSerializer.Meta.fields + ['ai_risk_score', 'ai_rationale']
        read_only_fields = fields
