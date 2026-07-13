from rest_framework import serializers
from .models import User, Profile


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['image', 'bio', 'momo_number', 'is_superhost', 'last_seen']
        read_only_fields = ['user']


class PublicProfileSerializer(serializers.ModelSerializer):
    """Profile fields safe to expose to any unauthenticated caller — no PII."""
    class Meta:
        model = Profile
        fields = ['image', 'bio', 'is_superhost']


class PublicUserSerializer(serializers.ModelSerializer):
    profile = PublicProfileSerializer(read_only=True)
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
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'is_staff', 'email_verified', 'has_password', 'profile'
        ]
        read_only_fields = ['id', 'is_staff', 'email_verified']

    def get_has_password(self, obj):
        return obj.has_usable_password()


class AdminUserSerializer(serializers.ModelSerializer):
    """Full account view for the staff-facing User Management dashboard —
    includes fields (email, is_active, deleted_at, is_superuser) that the
    public-facing serializers deliberately omit."""
    momo_number = serializers.SerializerMethodField()
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name', 'role',
            'is_staff', 'is_superuser', 'is_active', 'email_verified',
            'is_archived', 'deleted_at', 'date_joined', 'momo_number', 'has_password',
        ]

    def get_momo_number(self, obj):
        try:
            return obj.profile.momo_number
        except Exception:
            return ''

    def get_has_password(self, obj):
        return obj.has_usable_password()
