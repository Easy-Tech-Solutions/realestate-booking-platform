from django.db import models
from django.utils import timezone
import secrets


class Subscriber(models.Model):
    email = models.EmailField(unique=True, db_index=True)
    first_name = models.CharField(max_length=100, blank=True)

    is_active = models.BooleanField(default=True, db_index=True)

    # Interests for targeted newsletters
    interests = models.JSONField(default=list, blank=True)
    # e.g. ['new_listings', 'hotels', 'discounts', 'events']

    unsubscribe_token = models.CharField(max_length=64, unique=True, editable=False)

    subscribed_at   = models.DateTimeField(auto_now_add=True)
    unsubscribed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-subscribed_at']

    def save(self, *args, **kwargs):
        if not self.unsubscribe_token:
            self.unsubscribe_token = secrets.token_urlsafe(48)
        super().save(*args, **kwargs)

    def unsubscribe(self):
        self.is_active = False
        self.unsubscribed_at = timezone.now()
        self.save(update_fields=['is_active', 'unsubscribed_at'])

    def __str__(self):
        return f'{self.email} ({"active" if self.is_active else "unsubscribed"})'
