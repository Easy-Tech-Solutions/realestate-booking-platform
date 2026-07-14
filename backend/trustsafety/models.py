from django.conf import settings
from django.db import models


class AccountSignupEvent(models.Model):
    """One row per account created, capturing the IP it was created from.
    Powers the 'rapid account creation from one IP' fraud signal. Populated
    going forward from registration/Google-login — not backfilled for
    accounts that already existed when this was added."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='signup_event')
    ip_address = models.GenericIPAddressField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    def __str__(self):
        return f'{self.user.username} signed up from {self.ip_address}'


class FraudFlag(models.Model):
    """A suspicious-activity flag surfaced to Trust & Safety reviewers."""

    class FlagType(models.TextChoices):
        RAPID_SIGNUP     = 'rapid_signup',     'Rapid account creation from one IP'
        SHARED_CARD      = 'shared_card',      'Same card used across multiple accounts'
        TRANSACTION_SPIKE = 'transaction_spike', 'Unusual transaction volume'
        MANUAL           = 'manual',           'Manually flagged'

    class Severity(models.TextChoices):
        LOW    = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH   = 'high', 'High'

    class Status(models.TextChoices):
        OPEN      = 'open', 'Open'
        DISMISSED = 'dismissed', 'Dismissed'
        CONFIRMED = 'confirmed', 'Confirmed fraud'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True,
        related_name='fraud_flags',
    )
    flag_type = models.CharField(max_length=30, choices=FlagType.choices, db_index=True)
    severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.MEDIUM)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    details = models.TextField(blank=True, help_text='Evidence for this flag — which accounts/IPs/cards, etc.')

    # Placeholder for a future ML-based risk score. Always null until a real
    # model is integrated — every flag right now comes from a rule-based
    # detector (see detection.py), not a model prediction.
    ai_score = models.FloatField(null=True, blank=True, help_text='Populated asynchronously by the local scoring model — see aiscoring.tasks.score_fraud_flag_task.')
    ai_rationale = models.TextField(blank=True, default='')

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='fraud_flags_reviewed',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_flag_type_display()} ({self.status})'


class BlockedFingerprint(models.Model):
    """A device fingerprint blocked from registering or logging in."""
    fingerprint = models.CharField(max_length=128, unique=True, db_index=True)
    reason = models.TextField(blank=True)
    blocked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='fingerprints_blocked',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Blocked fingerprint {self.fingerprint[:12]}…'


class BlacklistedLocation(models.Model):
    """A banned coordinate + radius — e.g. a known 'party house' address that
    should never be listable again, regardless of which account tries."""
    name = models.CharField(max_length=255, help_text='Internal label, e.g. "123 Main St — repeated noise complaints"')
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    radius_km = models.DecimalField(max_digits=5, decimal_places=2, default=0.2)
    reason = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='locations_blacklisted',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name

    def contains(self, lat, lng) -> bool:
        """Cheap flat-earth approximation — fine at the sub-km scale this is
        used for (city-block-sized exclusion zones), not for long distances."""
        import math
        lat1, lng1 = float(self.latitude), float(self.longitude)
        km_per_deg_lat = 111.0
        km_per_deg_lng = 111.0 * math.cos(math.radians(lat1))
        dy = (float(lat) - lat1) * km_per_deg_lat
        dx = (float(lng) - lng1) * km_per_deg_lng
        return math.hypot(dx, dy) <= float(self.radius_km)
