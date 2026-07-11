import os

from rest_framework import serializers

from listings.models import Listing
from .models import PropertyVerification

# The MOU may be a PDF document or a picture (scan/photo).
ALLOWED_MOU_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif'}


def validate_mou_file(value):
    if not value:
        return value
    ext = os.path.splitext(value.name)[1].lower().lstrip('.')
    if ext not in ALLOWED_MOU_EXTENSIONS:
        raise serializers.ValidationError(
            'The MOU must be a PDF or an image (PNG, JPG, JPEG, WEBP, etc.).'
        )
    return value


class PropertyVerificationCreateSerializer(serializers.ModelSerializer):
    """Host submits a property (already created as a listing) for verification."""

    listing = serializers.PrimaryKeyRelatedField(queryset=Listing.objects.all())

    class Meta:
        model = PropertyVerification
        fields = [
            'listing', 'ownership_type', 'owner_name',
            'property_location', 'deed_volume_number', 'mou_document',
        ]
        extra_kwargs = {'mou_document': {'required': False}}

    def validate_mou_document(self, value):
        return validate_mou_file(value)

    def validate_listing(self, listing):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if listing.owner_id != getattr(user, 'id', None):
            raise serializers.ValidationError('You can only verify your own listing.')
        if PropertyVerification.objects.filter(listing=listing).exists():
            raise serializers.ValidationError('This listing already has a verification.')
        return listing

    def validate(self, attrs):
        if attrs.get('ownership_type') == PropertyVerification.OwnershipType.NON_OWNER \
                and not attrs.get('mou_document'):
            raise serializers.ValidationError(
                {'mou_document': 'A notarized MOU is required when you are not the owner.'}
            )
        return attrs


class PropertyVerificationResubmitSerializer(serializers.ModelSerializer):
    """Optional field updates the host can supply when resubmitting after a correction."""

    class Meta:
        model = PropertyVerification
        fields = ['owner_name', 'property_location', 'deed_volume_number', 'mou_document']
        extra_kwargs = {
            'owner_name':         {'required': False},
            'property_location':  {'required': False},
            'deed_volume_number': {'required': False},
            'mou_document':       {'required': False},
        }

    def validate_mou_document(self, value):
        return validate_mou_file(value)


class PropertyVerificationSerializer(serializers.ModelSerializer):
    """Read serializer returned to the host (status / correction / resubmit UI)."""

    status_display    = serializers.CharField(source='get_status_display', read_only=True)
    current_stage     = serializers.SerializerMethodField()
    listing_title     = serializers.CharField(source='listing.title', read_only=True)
    mou_document_url  = serializers.SerializerMethodField()
    can_resubmit      = serializers.SerializerMethodField()

    class Meta:
        model = PropertyVerification
        fields = [
            'id', 'listing', 'listing_title', 'ownership_type',
            'owner_name', 'property_location', 'deed_volume_number', 'mou_document_url',
            'status', 'status_display', 'current_stage',
            'outcome_stage', 'review_notes', 'can_resubmit', 'resubmission_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_current_stage(self, obj):
        return obj.current_stage or None

    def get_mou_document_url(self, obj):
        if not obj.mou_document:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(obj.mou_document.url) if request else obj.mou_document.url

    def get_can_resubmit(self, obj):
        return obj.status == PropertyVerification.Status.CORRECTION_REQUESTED
