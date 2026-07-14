from django.db import models
from django.conf import settings


# Reuse the SAME reviewer groups as the host-application flow — one set of
# officers handles both review types (stage access is scoped per queue).
GROUP_PRODUCT_SUPPORT = 'Product Support Officers'
GROUP_COMPLIANCE      = 'Compliance Officers'
GROUP_SUPERVISOR      = 'Supervisors'


def _mou_storage():
    """
    Notarized MOUs are documents (often PDFs). The default media storage in
    production is Cloudinary's image backend, which rejects non-images — so use
    Cloudinary's *raw* backend when Cloudinary is configured, and fall back to
    the default (filesystem) storage locally.
    """
    if getattr(settings, 'CLOUDINARY_URL', ''):
        from cloudinary_storage.storage import RawMediaCloudinaryStorage
        return RawMediaCloudinaryStorage()
    from django.core.files.storage import default_storage
    return default_storage


class PropertyVerification(models.Model):
    """
    Verification of a single property listing before it is published.

    Sequential 3-stage review (same pipeline / reviewer groups as host
    applications):
        submitted ─(PS approve)─▶ ps_approved ─(Compliance approve)─▶
        compliance_approved ─(Supervisor approve)─▶ approved  → listing published

    Any stage can REJECT (terminal) or REQUEST CORRECTION (returned to the host,
    who fixes and resubmits → re-enters review at the Product Support stage).
    """

    class OwnershipType(models.TextChoices):
        OWNER     = 'owner',     'Owner'
        NON_OWNER = 'non_owner', 'Non-Owner (MOU)'

    class Status(models.TextChoices):
        SUBMITTED            = 'submitted',            'Submitted — Product Support review'
        PS_APPROVED          = 'ps_approved',          'PS approved — Compliance review'
        COMPLIANCE_APPROVED  = 'compliance_approved',  'Compliance approved — Supervisor review'
        APPROVED             = 'approved',             'Approved & Published'
        REJECTED             = 'rejected',             'Rejected'
        CORRECTION_REQUESTED = 'correction_requested', 'Correction Requested'

    class Stage(models.TextChoices):
        PRODUCT_SUPPORT = 'product_support', 'Product Support Officer'
        COMPLIANCE      = 'compliance',      'Compliance Officer'
        SUPERVISOR      = 'supervisor',      'Supervisor'

    ACTIVE_STATUSES = (Status.SUBMITTED, Status.PS_APPROVED, Status.COMPLIANCE_APPROVED)

    listing = models.OneToOneField(
        'listings.Listing', on_delete=models.CASCADE, related_name='verification',
    )
    applicant = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='property_verifications',
    )

    ownership_type     = models.CharField(max_length=20, choices=OwnershipType.choices)
    owner_name         = models.CharField(max_length=255)
    property_location  = models.CharField(max_length=500)
    deed_volume_number = models.CharField(max_length=100)
    # Non-owner only: the notarized MOU document (PDF or image).
    mou_document       = models.FileField(
        upload_to='property_verifications/mou/', storage=_mou_storage, null=True, blank=True,
    )

    # Compliance-stage site inspection. The Compliance Officer confirms due
    # diligence and attaches an inspection report (PDF/PowerPoint) before the
    # property can advance to the Supervisor. null = not yet answered.
    due_diligence_done = models.BooleanField(null=True, blank=True)
    inspection_report  = models.FileField(
        upload_to='property_verifications/inspections/', storage=_mou_storage, null=True, blank=True,
    )
    # Captured on-site by the Compliance Officer during the physical
    # inspection, to corroborate the property's declared location — separate
    # from Listing.latitude/longitude (which the host self-reports at listing
    # creation and is never independently verified).
    inspection_latitude  = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    inspection_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    status = models.CharField(
        max_length=25, choices=Status.choices, default=Status.SUBMITTED, db_index=True,
    )

    # Per-stage audit trail.
    ps_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='property_verifs_ps_reviewed',
    )
    ps_reviewed_at = models.DateTimeField(null=True, blank=True)
    compliance_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='property_verifs_compliance_reviewed',
    )
    compliance_reviewed_at = models.DateTimeField(null=True, blank=True)
    supervisor_reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='property_verifs_supervisor_reviewed',
    )
    supervisor_reviewed_at = models.DateTimeField(null=True, blank=True)

    # Set on the latest reject / correction request.
    outcome_stage      = models.CharField(max_length=20, choices=Stage.choices, blank=True, default='')
    review_notes       = models.TextField(blank=True, default='')
    resubmission_count = models.PositiveIntegerField(default=0)

    # Populated asynchronously by aiscoring.tasks.score_property_verification_task
    # from the submitted text fields only — no MOU/inspection document image
    # is analyzed.
    ai_risk_score = models.FloatField(null=True, blank=True)
    ai_rationale = models.TextField(blank=True, default='')

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        permissions = [
            ('review_property_product_support', 'Can review property verifications at the Product Support stage'),
            ('review_property_compliance',      'Can review property verifications at the Compliance stage'),
            ('review_property_supervisor',      'Can review property verifications at the Supervisor stage'),
        ]

    def __str__(self):
        return f'Verification #{self.pk} — {self.listing.title} ({self.status})'

    @property
    def current_stage(self):
        """Which reviewer stage this verification is waiting on, or None if not in review."""
        return {
            self.Status.SUBMITTED:           self.Stage.PRODUCT_SUPPORT,
            self.Status.PS_APPROVED:         self.Stage.COMPLIANCE,
            self.Status.COMPLIANCE_APPROVED: self.Stage.SUPERVISOR,
        }.get(self.status)

    @property
    def is_active(self):
        return self.status in self.ACTIVE_STATUSES
