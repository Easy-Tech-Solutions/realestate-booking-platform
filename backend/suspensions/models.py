from django.db import models
from django.conf import settings
from django.utils import timezone


class Suspension(models.Model):

    class SuspensionType(models.TextChoices):
        TEMPORARY  = 'temporary',  'Temporary'
        INDEFINITE = 'indefinite', 'Indefinite'
        PERMANENT  = 'permanent',  'Permanent Ban'

    class Status(models.TextChoices):
        ACTIVE  = 'active',  'Active'
        EXPIRED = 'expired', 'Expired'   # natural expiry (ends_at passed)
        REVOKED = 'revoked', 'Revoked'   # manually lifted by admin early

    #Core relationship
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='suspensions',
    )
    issued_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='suspensions_issued',
    )

    #Suspension details
    suspension_type = models.CharField(
        max_length=20,
        choices=SuspensionType.choices,
        db_index=True,
    )
    reason = models.TextField(
        help_text='Internal reason visible only to admins.',
    )

    #Duration
    started_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ends_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Leave blank for indefinite or permanent suspensions.',
    )

    #Status
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.ACTIVE,
        db_index=True,
    )

    #Early revocation
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='suspensions_revoked',
    )
    revoked_at = models.DateTimeField(null=True, blank=True)
    revocation_reason = models.TextField(blank=True)

    #Optional link to a report that triggered this suspension
    related_report = models.ForeignKey(
        'reports.Report',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='suspensions',
    )

    user_notified = models.BooleanField(default=False)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return (
            f'Suspension #{self.pk} — {self.user.username} '
            f'[{self.suspension_type}] ({self.status})'
        )


    # Computed helpers

    @property
    def is_currently_active(self):
        """True only when the suspension is genuinely blocking the user right now."""
        if self.status != self.Status.ACTIVE:
            return False
        if self.ends_at and self.ends_at <= timezone.now():
            return False
        return True


    # State transitions

    def revoke(self, admin_user, reason=''):
        """Lift the suspension early."""
        self.status = self.Status.REVOKED
        self.revoked_by = admin_user
        self.revoked_at = timezone.now()
        self.revocation_reason = reason
        self.save(update_fields=[
            'status', 'revoked_by', 'revoked_at', 'revocation_reason', 'updated_at',
        ])

    def mark_expired(self):
        """Called by the expiry task when ends_at has passed naturally."""
        self.status = self.Status.EXPIRED
        self.save(update_fields=['status', 'updated_at'])
