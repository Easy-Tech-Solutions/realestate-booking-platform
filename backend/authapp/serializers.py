from rest_framework import serializers
<<<<<<< HEAD
<<<<<<< HEAD
from django.contrib.auth import get_user_model

User = get_user_model()
=======
from django.contrib.auth.models import User
>>>>>>> dalton
=======
from django.contrib.auth import get_user_model

User = get_user_model()
>>>>>>> origin/jake

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email"]
<<<<<<< HEAD
<<<<<<< HEAD
        read_only_fields = ("id",)

=======
>>>>>>> dalton
=======
        read_only_fields = ("id",)

>>>>>>> origin/jake
