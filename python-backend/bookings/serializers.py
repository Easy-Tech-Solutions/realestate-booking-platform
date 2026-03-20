from rest_framework import serializers
from .models import Booking
from django.utils import timezone

#For owner to confirm/decline bookings
class BookingConfrimationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ['status', 'owner_notes', 'decline_reason']


class BookingSerializer(serializers.ModelSerializer):
    customer_username = serializers.CharField(source='customer.username', read_only=True)
    listing_title = serializers.CharField(source='listing.title', read_only=True)
    listing_owner = serializers.CharField(source='listing.owner.username', read_only=True)
    days_until_expiry = serializers.SerializerMethodField()
    
    class Meta:
        model = Booking
        fields = [
            'id', 'customer', 'customer_username', 'listing', 'listing_title', 
            'listing_owner', 'start_date', 'end_date', 'status', 'notes', 
            'requested_at', 'confirmed_at', 'declined_at', 'owner_notes', 
            'decline_reason', 'days_until_expiry' 
        ]
        read_only_fields = ['customer', 'requested_at', 'confirmed_at', 'declined_at']

    
    def get_days_until_expiry(self, obj):
        if obj.status == 'requested' and obj.requested_at:
            from datetime import timedelta
            from django.utils import timezone
            expiry_time = obj.requested_at + timedelta(hours=48)
            remaining = expiry_time - timezone.now()
            return max(0, remaining.days)
        
        return 0

class BookingCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ['listing', 'start_date', 'end_date', 'notes']

    def validate(self, data):
        from django.utils import timezone

        #Check date validity 
        if data['start_date'] >= data['end_date']:
            raise serializers.ValidationError('End date must be after start date')
        
        #Check if dates are in the past
        if data['start_date'] < timezone.now().date():
            raise serializers.ValidationError('Start date cannot be in the past')
        
        return data

