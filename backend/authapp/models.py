from django.db import models
from django.conf import settings
# Placeholder model(s) if needed later

class BlacklistedToken(models.Model):
    token = models.CharField(max_length=500, unique=True)
    blacklisted_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"Token blacklisted at {self.blacklisted_at}"


class SocialAccount(models.Model):
    PROVIDER_GOOGLE = 'google'
    PROVIDER_CHOICES = [
        (PROVIDER_GOOGLE, 'Google'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='social_accounts',
    )
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)
    provider_user_id = models.CharField(max_length=255)
    email_at_link = models.EmailField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('provider', 'provider_user_id')]
        indexes = [
            models.Index(fields=['provider', 'provider_user_id']),
        ]

    def __str__(self):
        return f'{self.user.username} - {self.get_provider_display()}'
