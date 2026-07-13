from rest_framework import serializers
from django.contrib.auth import get_user_model
from users.serializers import ProfileSerializer

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)
    has_password = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'is_staff', 'email_verified', 'has_password', 'profile',
        ]
        read_only_fields = ('id', 'is_staff')

    def get_has_password(self, obj):
        # False for accounts created via Google SSO (set_unusable_password()).
        # The frontend uses this to decide whether to ask for the current
        # password before sensitive operations like changing the MoMo number.
        return obj.has_usable_password()
