from rest_framework import serializers
<<<<<<< HEAD
from django.contrib.auth import get_user_model

User = get_user_model()
=======
from django.contrib.auth.models import User
>>>>>>> dalton

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email"]
<<<<<<< HEAD
        read_only_fields = ("id",)

=======
>>>>>>> dalton
