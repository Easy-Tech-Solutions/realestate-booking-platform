from django.db import models
from django.conf import settings


def _document_storage():
    """
    Lease PDFs are documents. Use Cloudinary's raw backend in production
    (image backend rejects PDFs) and the default (filesystem) storage locally.
    """
    if getattr(settings, 'CLOUDINARY_URL', ''):
        from cloudinary_storage.storage import RawMediaCloudinaryStorage
        return RawMediaCloudinaryStorage()
    from django.core.files.storage import default_storage
    return default_storage


class LeaseAgreement(models.Model):
    """
    The generated Agreement of Lease PDF for one (long-term) booking, plus the
    snapshot of the values filled into the template — kept for audit even if the
    listing / users later change.
    """
    booking = models.OneToOneField(
        'bookings.Booking', on_delete=models.CASCADE, related_name='lease_agreement',
    )
    version  = models.CharField(max_length=20)
    document = models.FileField(
        upload_to='lease_agreements/', storage=_document_storage, null=True, blank=True,
    )

    # Snapshot of what was filled into the lease.
    landlord_name    = models.CharField(max_length=255, blank=True, default='')
    tenant_name      = models.CharField(max_length=255, blank=True, default='')
    property_address = models.CharField(max_length=500, blank=True, default='')
    rent_display     = models.CharField(max_length=120, blank=True, default='')
    lease_start      = models.DateField(null=True, blank=True)
    lease_end        = models.DateField(null=True, blank=True)

    generated_at = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-generated_at']

    def __str__(self):
        return f'Lease v{self.version} for booking #{self.booking_id}'

    @property
    def acceptance(self):
        """The tenant's acceptance of THIS lease version, if any."""
        return self.booking.lease_acceptances.filter(version=self.version).order_by('-accepted_at').first()

    @property
    def is_accepted(self):
        return self.booking.lease_acceptances.filter(version=self.version).exists()


class LeaseAcceptance(models.Model):
    """
    Immutable audit record that a tenant accepted the Agreement of Lease for a
    specific reservation (user ID, reservation ID, version, timestamp).
    """
    booking = models.ForeignKey(
        'bookings.Booking', on_delete=models.CASCADE, related_name='lease_acceptances',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='lease_acceptances',
    )
    version     = models.CharField(max_length=20)
    accepted_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_address  = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ['-accepted_at']
        unique_together = ('user', 'booking', 'version')

    def __str__(self):
        return f'{self.user} accepted lease v{self.version} for booking #{self.booking_id}'
