from django.db import models
from django.conf import settings


# Reuse the SAME reviewer groups as host applications / property verifications.
GROUP_PRODUCT_SUPPORT = 'Product Support Officers'
GROUP_COMPLIANCE      = 'Compliance Officers'
GROUP_SUPERVISOR      = 'Supervisors'

# Placeholder version — the Agent Agreement document text is still TBD (the
# acceptance gate is enforced now; bump this when the real document lands).
AGENT_AGREEMENT_VERSION = '1.0'


class AgentApplication(models.Model):
    """
    A user's application to become a *sourcing agent* — a middleman who lists
    properties on behalf of owners (they never own or manage them; see the
    `agentsourcing` fields on Listing). Distinct from a host.

    Same sequential 3-stage review as host applications:
        submitted → ps_approved → compliance_approved → approved
    On final approval the applicant gets an approved AgentProfile (the
    capability), NOT a role change.
    """

    class Status(models.TextChoices):
        SUBMITTED           = 'submitted',           'Submitted — Product Support review'
        PS_APPROVED         = 'ps_approved',         'PS approved — Compliance review'
        COMPLIANCE_APPROVED = 'compliance_approved', 'Compliance approved — Supervisor review'
        APPROVED            = 'approved',            'Approved'
        DECLINED            = 'declined',            'Declined'

    class Stage(models.TextChoices):
        PRODUCT_SUPPORT = 'product_support', 'Product Support Officer'
        COMPLIANCE      = 'compliance',      'Compliance Officer'
        SUPERVISOR      = 'supervisor',      'Supervisor'

    ACTIVE_STATUSES = (Status.SUBMITTED, Status.PS_APPROVED, Status.COMPLIANCE_APPROVED)

    applicant = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agent_applications',
    )

    # Snapshot of what was submitted (email is taken from the account server-side).
    full_name = models.CharField(max_length=255)
    address   = models.CharField(max_length=500)
    phone     = models.CharField(max_length=30)
    id_document = models.ImageField(upload_to='agent_applications/ids/')

    # Agent Agreement acceptance (document TBD; the gate is enforced now).
    agreement_version     = models.CharField(max_length=20, blank=True, default='')
    agreement_accepted_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(
        max_length=25, choices=Status.choices, default=Status.SUBMITTED, db_index=True,
    )

    ps_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='agent_apps_ps_reviewed',
    )
    ps_reviewed_at = models.DateTimeField(null=True, blank=True)
    compliance_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='agent_apps_compliance_reviewed',
    )
    compliance_reviewed_at = models.DateTimeField(null=True, blank=True)
    supervisor_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='agent_apps_supervisor_reviewed',
    )
    supervisor_reviewed_at = models.DateTimeField(null=True, blank=True)

    declined_stage = models.CharField(max_length=20, choices=Stage.choices, blank=True, default='')
    decline_reason = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        permissions = [
            ('review_agent_product_support', 'Can review agent applications at the Product Support stage'),
            ('review_agent_compliance',      'Can review agent applications at the Compliance stage'),
            ('review_agent_supervisor',      'Can review agent applications at the Supervisor stage'),
        ]

    def __str__(self):
        return f'Agent application #{self.pk} — {self.applicant.username} ({self.status})'

    @property
    def current_stage(self):
        return {
            self.Status.SUBMITTED:           self.Stage.PRODUCT_SUPPORT,
            self.Status.PS_APPROVED:         self.Stage.COMPLIANCE,
            self.Status.COMPLIANCE_APPROVED: self.Stage.SUPERVISOR,
        }.get(self.status)

    @property
    def is_active(self):
        return self.status in self.ACTIVE_STATUSES


class AgentProfile(models.Model):
    """
    The approved sourcing-agent capability, layered on any user (a host or a
    plain user can also be an agent). Created when an AgentApplication is
    approved; `is_active` is the single source of truth for "is an agent".
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agent_profile',
    )
    is_active   = models.BooleanField(default=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    # The application that granted the capability (audit).
    application = models.ForeignKey(
        AgentApplication, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='granted_profiles',
    )

    def __str__(self):
        return f'AgentProfile({self.user.username}, active={self.is_active})'


def is_approved_agent(user) -> bool:
    """True if the user is an active, approved sourcing agent."""
    if not user or not user.is_authenticated:
        return False
    return AgentProfile.objects.filter(user=user, is_active=True).exists()


class AgentCommission(models.Model):
    """
    Commission owed to a sourcing agent for a confirmed booking on a property
    they sourced. Created when Home Konet confirms the guest payment; disbursed
    separately (admin), or voided if the booking is refunded before disbursement.
    """
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PAID    = 'paid',    'Paid'
        VOIDED  = 'voided',  'Voided'

    booking = models.OneToOneField(
        'bookings.Booking', on_delete=models.CASCADE, related_name='agent_commission',
    )
    agent   = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='agent_commissions',
    )
    listing = models.ForeignKey(
        'listings.Listing', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='agent_commissions',
    )

    booking_amount = models.DecimalField(max_digits=12, decimal_places=2)  # the rent basis (B)
    amount         = models.DecimalField(max_digits=12, decimal_places=2)  # commission owed
    currency       = models.CharField(max_length=3, default='USD')

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    reference = models.CharField(max_length=255, blank=True, default='')
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='agent_commissions_paid',
    )
    voided_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Commission {self.amount} {self.currency} → {self.agent.username} ({self.status})'

