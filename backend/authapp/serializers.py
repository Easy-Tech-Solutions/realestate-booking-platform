from rest_framework import serializers
from django.contrib.auth import get_user_model
from users.serializers import ProfileSerializer

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'email_verified', 'profile',
        ]
        read_only_fields = ('id',)
