from rest_framework import serializers
from .models import Listing

class ListingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Listing
        fields = ["id", "title", "description", "price", "property_type", "address", "square_footage", "is_available", "created_at", "updated_at"]
