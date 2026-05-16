from rest_framework import serializers
from .models import Testimonial


class TestimonialSerializer(serializers.ModelSerializer):
    avatar_initials = serializers.CharField(read_only=True)

    class Meta:
        model = Testimonial
        fields = ['id', 'name', 'location', 'rating', 'quote', 'avatar_color', 'avatar_initials', 'created_at']
        read_only_fields = ['id', 'avatar_initials', 'created_at']


class TestimonialCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=100)
    location = serializers.CharField(max_length=150, required=False, allow_blank=True)
    rating = serializers.IntegerField(min_value=1, max_value=5, default=5)
    quote = serializers.CharField(min_length=20, max_length=1000)
