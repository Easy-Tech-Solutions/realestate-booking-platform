from rest_framework import serializers
from .models import Booking

class BookingSerializer(serializers.ModelSerializer):
    customer_username = serializers.CharField(source='customer.username', read_only=True)
    listing_title = serializers.CharField(source='listing.title', read_only=True)
    listing_owner = serializers.CharField(source='listing.owner.username', read_only=True)
    
    class Meta:
        model = Booking
        fields = [
            'id', 'customer', 'customer_username', 'listing', 'listing_title', 
            'listing_owner', 'start_date', 'end_date', 'status', 'notes', 
            'created_at', 'updated_at'
        ]
        read_only_fields = ['customer', 'created_at', 'updated_at']
