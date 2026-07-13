from django.conf import settings
from django.db import models


class ListingFlag(models.Model):
    """A moderation flag surfaced to Inventory & Listings reviewers."""

    class FlagType(models.TextChoices):
        DUPLICATE      = 'duplicate',      'Possible duplicate listing'
        PRICE_ANOMALY  = 'price_anomaly',  'Price far outside normal range'
        MANUAL         = 'manual',         'Manually flagged'

    class Severity(models.TextChoices):
        LOW    = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH   = 'high', 'High'

    class Status(models.TextChoices):
        OPEN      = 'open', 'Open'
        DISMISSED = 'dismissed', 'Dismissed'
        CONFIRMED = 'confirmed', 'Confirmed violation'

    listing = models.ForeignKey(
        'listings.Listing', on_delete=models.CASCADE, null=True, blank=True,
        related_name='moderation_flags',
    )
    flag_type = models.CharField(max_length=30, choices=FlagType.choices, db_index=True)
    severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.MEDIUM)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    details = models.TextField(blank=True, help_text='Evidence for this flag — which listings/prices, etc.')

    # Placeholder for a future ML-based content/image moderation score.
    # Always null until a real model is integrated — every flag right now
    # comes from a rule-based detector (see detection.py).
    ai_score = models.FloatField(null=True, blank=True, help_text='Reserved for a future ML content-moderation model. Not yet populated.')

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='listing_flags_reviewed',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_flag_type_display()} ({self.status})'
