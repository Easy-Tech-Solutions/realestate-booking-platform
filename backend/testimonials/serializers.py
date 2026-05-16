from rest_framework import serializers
from .models import Testimonial


class TestimonialSerializer(serializers.ModelSerializer):
    avatar_initials = serializers.CharField(read_only=True)
    user_avatar = serializers.SerializerMethodField()

    class Meta:
        model = Testimonial
        fields = [
            'id', 'name', 'location', 'rating', 'quote',
            'avatar_color', 'avatar_initials', 'user_avatar', 'created_at',
        ]
        read_only_fields = ['id', 'avatar_initials', 'user_avatar', 'created_at']

    def get_user_avatar(self, obj):
        if not obj.user:
            return None
        try:
            if obj.user.profile.image:
                return obj.user.profile.image.url
        except Exception:
            pass
        return None


class TestimonialCreateSerializer(serializers.Serializer):
    location = serializers.CharField(max_length=150, required=False, allow_blank=True)
    rating = serializers.IntegerField(min_value=1, max_value=5, default=5)
    quote = serializers.CharField(min_length=5, max_length=1000)
