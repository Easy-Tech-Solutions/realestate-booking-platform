from django.db import models
<<<<<<< HEAD
<<<<<<< HEAD
from django.conf import settings
# Placeholder model(s) if needed later

class BlacklistedToken(models.Model):
    token = models.CharField(max_length=500, unique=True)
    blacklisted_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Token blacklisted at {self.blacklisted_at}"
=======

# Placeholder model(s) if needed later
>>>>>>> dalton
=======
from django.conf import settings
# Placeholder model(s) if needed later

class BlacklistedToken(models.Model):
    token = models.CharField(max_length=500, unique=True)
    blacklisted_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Token blacklisted at {self.blacklisted_at}"
>>>>>>> origin/jake
