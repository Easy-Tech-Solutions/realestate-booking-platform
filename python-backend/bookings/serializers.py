from rest_framework import serializers
from .models import Booking

class BookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ["id", "listing_title", "customer_name", "start_date", "end_date", "created_at"]
