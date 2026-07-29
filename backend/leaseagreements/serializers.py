from rest_framework import serializers

from .models import LeaseAgreement


class LeaseAgreementSerializer(serializers.ModelSerializer):
    document_url = serializers.SerializerMethodField()
    is_accepted  = serializers.BooleanField(read_only=True)
    accepted_at  = serializers.SerializerMethodField()

    class Meta:
        model = LeaseAgreement
        fields = [
            'id', 'booking', 'version', 'document_url',
            'landlord_name', 'tenant_name', 'property_address',
            'rent_display', 'lease_start', 'lease_end',
            'is_accepted', 'accepted_at', 'generated_at',
        ]
        read_only_fields = fields

    def get_document_url(self, obj):
        if not obj.document:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.document.url) if request else obj.document.url

    def get_accepted_at(self, obj):
        acc = obj.acceptance
        return acc.accepted_at.isoformat() if acc else None
