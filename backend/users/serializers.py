from rest_framework import serializers
from .models import User, Profile


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['image', 'bio', 'momo_number', 'is_superhost']
        read_only_fields = ['user']


class PublicUserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)
    is_superhost = serializers.SerializerMethodField()
    member_since = serializers.DateTimeField(source='date_joined', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'profile',
                  'is_superhost', 'member_since', 'email_verified']

    def get_is_superhost(self, obj):
        try:
            return obj.profile.is_superhost
        except Exception:
            return False


class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'email_verified', 'profile'
        ]
        read_only_fields = ['id', 'email_verified']
