from django.db import models
from django.contrib.auth.models import AbstractUser

# Placeholder custom user-related models could go here later

class User(AbstractUser):
    email_verified = models.BooleanField(default=False)
    email_verification_token = models.CharField(max_length=100, blank=True, null=True)