from django.db import models
from django.conf import settings
from django.utils import timezone


class Report(models.Model):

    class ReportType(models.TextChoices):
        SCAM                  = 'scam','Scam / Fraud'
        FAKE_LISTING          = 'fake_listing','Fake Listing'
        INAPPROPRIATE_CONTENT = 'inappropriate_content','Inappropriate Content'
        HARASSMENT            = 'harassment','Harassment'
        WRONG_INFO            = 'wrong_info','Wrong Information'
        OTHER                 = 'other','Other'

    class ContentType(models.TextChoices):
        USER    = 'user','User'
        LISTING = 'listing','Listing'
        REVIEW  = 'review','Review'
        MESSAGE = 'message','Message'

    class Status(models.TextChoices):
        PENDING      = 'pending','Pending'
        UNDER_REVIEW = 'under_review','Under Review'
        RESOLVED     = 'resolved','Resolved'
        DISMISSED    = 'dismissed','Dismissed'

    # Who filed the report
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='reports_made',
    )

    # What kind of content is being reported
    content_type = models.CharField(
        max_length=20,
        choices=ContentType.choices,
        db_index=True,
    )

    # Target references — nullable so deleted content doesn't cascade-delete reports
    reported_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reports_received',
    )
    reported_listing = models.ForeignKey(
        'listings.Listing',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reports',
    )
    reported_review = models.ForeignKey(
        'listings.Review',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reports',
    )
    reported_message = models.ForeignKey(
        'messaging.Message',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reports',
    )

    # Report details
    report_type = models.CharField(max_length=30, choices=ReportType.choices, db_index=True)
    description = models.TextField()

    # Admin workflow
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    admin_notes = models.TextField(blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reports_resolved',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Report #{self.pk} [{self.report_type}] by {self.reporter.username} — {self.status}'

    def mark_under_review(self, admin_user):
        self.status = self.Status.UNDER_REVIEW
        self.resolved_by = admin_user
        self.save(update_fields=['status', 'resolved_by', 'updated_at'])

    def resolve(self, admin_user, notes=''):
        self.status = self.Status.RESOLVED
        self.resolved_by = admin_user
        self.resolved_at = timezone.now()
        if notes:
            self.admin_notes = notes
        self.save(update_fields=['status', 'resolved_by', 'resolved_at', 'admin_notes', 'updated_at'])

    def dismiss(self, admin_user, notes=''):
        self.status = self.Status.DISMISSED
        self.resolved_by = admin_user
        self.resolved_at = timezone.now()
        if notes:
            self.admin_notes = notes
        self.save(update_fields=['status', 'resolved_by', 'resolved_at', 'admin_notes', 'updated_at'])
