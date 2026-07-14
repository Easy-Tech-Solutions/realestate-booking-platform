from rest_framework import serializers

from listings.models import Listing
from .models import ListingFlag


class ListingFlagSerializer(serializers.ModelSerializer):
    listing_title = serializers.CharField(source='listing.title', default=None, read_only=True)
    listing_status = serializers.CharField(source='listing.status', default=None, read_only=True)
    flag_type_display = serializers.CharField(source='get_flag_type_display', read_only=True)
    reviewed_by_username = serializers.CharField(source='reviewed_by.username', default=None, read_only=True)

    class Meta:
        model = ListingFlag
        fields = [
            'id', 'listing', 'listing_title', 'listing_status', 'flag_type', 'flag_type_display',
            'severity', 'status', 'details', 'ai_score', 'ai_rationale',
            'reviewed_by', 'reviewed_by_username', 'reviewed_at', 'review_notes',
            'created_at',
        ]
        read_only_fields = [
            'id', 'listing_title', 'listing_status', 'flag_type_display',
            'ai_score', 'ai_rationale', 'reviewed_by', 'reviewed_by_username', 'reviewed_at', 'created_at',
        ]


class InventoryListingSerializer(serializers.ModelSerializer):
    """Global-inventory view of a listing — every status, not just published,
    for Inventory & Listings staff searching across the whole catalog."""
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    owner_email = serializers.CharField(source='owner.email', read_only=True)
    suspended_by_username = serializers.CharField(source='suspended_by.username', default=None, read_only=True)
    open_flag_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Listing
        fields = [
            'id', 'title', 'status', 'price', 'property_type', 'city', 'state', 'country',
            'owner', 'owner_username', 'owner_email',
            'deleted_at', 'suspended_by', 'suspended_by_username', 'suspended_at', 'suspension_reason',
            'max_guests', 'local_registration_number', 'occupancy_cap',
            'open_flag_count', 'created_at', 'updated_at',
        ]
        read_only_fields = fields
