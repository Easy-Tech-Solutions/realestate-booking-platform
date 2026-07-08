from django.db import models
from django.conf import settings
from django.utils import timezone


# ---------------------------------------------------------------------------
# Group names — the three reviewer roles. Defined here so the data migration,
# the admin, and the notification layer all reference the same strings.
# ---------------------------------------------------------------------------
GROUP_PRODUCT_SUPPORT = 'Product Support Officers'
GROUP_COMPLIANCE = 'Compliance Officers'
GROUP_SUPERVISOR = 'Supervisors'


class HostApplication(models.Model):
    """
    A user's application to become a host/agent.

    Flows through a strictly sequential 3-stage review:
        submitted ──(PS approve)──> ps_approved ──(Compliance approve)──>
        compliance_approved ──(Supervisor approve)──> approved
    A decline at any stage is terminal. On final approval the applicant's
    User.role is flipped to 'agent' so they can list properties.
    """

    class Status(models.TextChoices):
        SUBMITTED = 'submitted', 'Submitted — Product Support review'
        PS_APPROVED = 'ps_approved', 'PS approved — Compliance review'
        COMPLIANCE_APPROVED = 'compliance_approved', 'Compliance approved — Supervisor review'
        APPROVED = 'approved', 'Approved'
        DECLINED = 'declined', 'Declined'

    class Stage(models.TextChoices):
        PRODUCT_SUPPORT = 'product_support', 'Product Support Officer'
        COMPLIANCE = 'compliance', 'Compliance Officer'
        SUPERVISOR = 'supervisor', 'Supervisor'

    # Statuses where the application is still moving through review.
    ACTIVE_STATUSES = (Status.SUBMITTED, Status.PS_APPROVED, Status.COMPLIANCE_APPROVED)

    applicant = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='host_applications',
    )

    # Snapshot of the details submitted on the form (kept independent of the
    # user's live profile so the record reflects what was reviewed). The email
    # is read-only on the form and taken from the account server-side.
    full_name = models.CharField(max_length=255)
    address   = models.CharField(max_length=500)
    phone     = models.CharField(max_length=30)

    # Sensitive PII — identity documents.
    headshot    = models.ImageField(upload_to='host_applications/headshots/')
    id_document = models.ImageField(upload_to='host_applications/ids/')

    status = models.CharField(
        max_length=25,
        choices=Status.choices,
        default=Status.SUBMITTED,
        db_index=True,
    )

    # Per-stage audit trail.
    ps_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='host_apps_ps_reviewed',
    )
    ps_reviewed_at = models.DateTimeField(null=True, blank=True)
    compliance_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='host_apps_compliance_reviewed',
    )
    compliance_reviewed_at = models.DateTimeField(null=True, blank=True)
    supervisor_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='host_apps_supervisor_reviewed',
    )
    supervisor_reviewed_at = models.DateTimeField(null=True, blank=True)

    # Set when declined.
    declined_stage = models.CharField(max_length=20, choices=Stage.choices, blank=True, default='')
    decline_reason = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        permissions = [
            ('review_product_support', 'Can review host applications at the Product Support stage'),
            ('review_compliance',      'Can review host applications at the Compliance stage'),
            ('review_supervisor',      'Can review host applications at the Supervisor stage'),
        ]

    def __str__(self):
        return f'Host application #{self.pk} — {self.applicant.username} ({self.status})'

    @property
    def current_stage(self):
        """Which reviewer stage this application is waiting on, or None if terminal."""
        return {
            self.Status.SUBMITTED:           self.Stage.PRODUCT_SUPPORT,
            self.Status.PS_APPROVED:         self.Stage.COMPLIANCE,
            self.Status.COMPLIANCE_APPROVED: self.Stage.SUPERVISOR,
        }.get(self.status)

    @property
    def is_active(self):
        return self.status in self.ACTIVE_STATUSES


class AgreementAcceptance(models.Model):
    """
    Immutable audit record that a user accepted a legal agreement version.

    One row per (user, agreement, version). Acceptance is keyed by version so
    that publishing a new agreement version requires a fresh acceptance, while
    an already-accepted version is never re-prompted.
    """
    AGREEMENT_PROPERTY_OWNER = 'property_owner'
    AGREEMENT_CHOICES = [
        (AGREEMENT_PROPERTY_OWNER, 'Property Owner Listing Agreement'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='agreement_acceptances',
    )
    agreement = models.CharField(
        max_length=40, choices=AGREEMENT_CHOICES, default=AGREEMENT_PROPERTY_OWNER, db_index=True,
    )
    version = models.CharField(max_length=20)
    accepted_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ['-accepted_at']
        unique_together = ('user', 'agreement', 'version')

    def __str__(self):
        return f'{self.user} accepted {self.agreement} v{self.version} @ {self.accepted_at:%Y-%m-%d %H:%M}'
