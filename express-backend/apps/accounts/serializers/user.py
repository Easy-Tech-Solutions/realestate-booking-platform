from rest_framework import serializers
from apps.accounts.models.user import User
from apps.accounts.models.role import Role


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "name", "description", "is_admin", "is_owner", "is_user"]


class UserSerializer(serializers.ModelSerializer):
    roles = RoleSerializer(many=True, read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "phone_number",
            "is_email_verified",
            "is_phone_verified",
            "is_active",
            "roles",
        ]
