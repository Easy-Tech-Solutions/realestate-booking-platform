from rest_framework import serializers
from .models import Subscriber


class SubscribeSerializer(serializers.Serializer):
    email      = serializers.EmailField()
    first_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    interests  = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False,
        default=list,
    )


class SubscriberSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Subscriber
        fields = ['id', 'email', 'first_name', 'interests', 'is_active', 'subscribed_at']
        read_only_fields = fields
