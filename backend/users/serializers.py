from rest_framework import serializers
<<<<<<< HEAD
<<<<<<< HEAD
from .models import User, Profile
=======
from django.contrib.auth.models import User
>>>>>>> dalton
=======
from .models import User, Profile
>>>>>>> origin/jake

class PublicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username"]
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> origin/jake

class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = ['image','bio']
        read_only_fields = ['user']

class UserSerializer(serializers.ModelSerializer):
    profile = ProfileSerializer(read_only=True)

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'email_verified', 'profile'
        ]
<<<<<<< HEAD
        read_only_fields = ['id','email_verified']
=======
>>>>>>> dalton
=======
        read_only_fields = ['id','email_verified']
>>>>>>> origin/jake
