from django.db import models
from django.conf import settings
from django.utils import timezone
import random
import string


def _get_conversation_model():
    from messaging.models import Conversation
    return Conversation


def _gen_ticket_number():
    prefix = timezone.now().strftime('%Y%m%d')
    suffix = ''.join(random.choices(string.digits, k=6))
    return f'HK-{prefix}-{suffix}'


class ContactInquiry(models.Model):
    CATEGORY_CHOICES = [
        ('general', 'General Inquiry'),
        ('booking', 'Booking Help'),
        ('payment', 'Payment Issue'),
        ('listing', 'Listing Question'),
        ('partnership', 'Partnership'),
        ('other', 'Other'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='contact_inquiries',
    )
    conversation = models.OneToOneField(
        'messaging.Conversation', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='contact_inquiry',
    )
    name = models.CharField(max_length=100)
    email = models.EmailField()
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default='general')
    subject = models.CharField(max_length=200)
    message = models.TextField()
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} — {self.subject}'


class SupportTicket(models.Model):
    CATEGORY_CHOICES = [
        ('account', 'Account & Profile'),
        ('booking', 'Booking Issue'),
        ('payment', 'Payment & Refunds'),
        ('listing', 'Listing Problem'),
        ('safety', 'Safety Concern'),
        ('technical', 'Technical Issue'),
        ('host', 'Host Support'),
        ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('open', 'Open'),
        ('in_progress', 'In Progress'),
        ('pending_user', 'Pending User Response'),
        ('resolved', 'Resolved'),
        ('closed', 'Closed'),
    ]
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('urgent', 'Urgent'),
    ]

    ticket_number = models.CharField(max_length=30, unique=True, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='support_tickets',
    )
    guest_name = models.CharField(max_length=100, blank=True)
    guest_email = models.EmailField(blank=True)

    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    subject = models.CharField(max_length=200)
    description = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='medium')
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='assigned_tickets',
    )

    conversation = models.OneToOneField(
        'messaging.Conversation', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='support_ticket',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # SLA deadline, recomputed from `created_at` whenever priority changes —
    # see support.sla.sla_deadline_for(). Null only if it predates this field.
    sla_due_at = models.DateTimeField(null=True, blank=True)

    # Escalation — a support agent flags a dispute for supervisor attention.
    # This is a flag + audit trail, not a multi-tier routing system: there is
    # no separate escalation queue/tier hierarchy modeled, just "this needs a
    # closer look" plus who raised that and why.
    escalated_at = models.DateTimeField(null=True, blank=True)
    escalated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='tickets_escalated',
    )
    escalation_notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        if not self.ticket_number:
            self.ticket_number = _gen_ticket_number()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.ticket_number} — {self.subject}'

    @property
    def requester_name(self):
        if self.user:
            return f'{self.user.first_name} {self.user.last_name}'.strip() or self.user.username
        return self.guest_name

    @property
    def requester_email(self):
        if self.user:
            return self.user.email
        return self.guest_email


class TicketMessage(models.Model):
    ticket = models.ForeignKey(SupportTicket, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='ticket_messages',
    )
    sender_name = models.CharField(max_length=100, blank=True)
    is_staff_reply = models.BooleanField(default=False)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'Message on {self.ticket.ticket_number}'


class TicketAttachment(models.Model):
    ticket = models.ForeignKey(SupportTicket, on_delete=models.CASCADE, related_name='attachments')
    file = models.FileField(upload_to='support/attachments/')
    filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField(default=0)
    content_type = models.CharField(max_length=100, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Attachment: {self.filename}'


class AirCoverClaim(models.Model):
    """A property-damage / liability claim tied to a booking. Filed by
    either party (the guest, e.g. for a safety issue, or the host, e.g. for
    property damage). Approving a claim does NOT auto-disburse money —
    financial ops still manually issues the payout/refund via the existing
    tools, cross-referenced by this claim's id, exactly like every other
    payment action in this codebase requires a human to actually move funds."""

    class ClaimType(models.TextChoices):
        PROPERTY_DAMAGE = 'property_damage', 'Property Damage'
        MISSING_ITEMS = 'missing_items', 'Missing Items'
        CLEANLINESS = 'cleanliness', 'Cleanliness'
        SAFETY = 'safety', 'Safety Issue'
        OTHER = 'other', 'Other'

    class Status(models.TextChoices):
        SUBMITTED = 'submitted', 'Submitted'
        UNDER_REVIEW = 'under_review', 'Under Review'
        APPROVED = 'approved', 'Approved'
        DENIED = 'denied', 'Denied'
        PAID = 'paid', 'Paid'

    booking = models.ForeignKey('bookings.Booking', on_delete=models.CASCADE, related_name='aircover_claims')
    claimant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='aircover_claims_filed')
    claim_type = models.CharField(max_length=20, choices=ClaimType.choices)
    description = models.TextField()
    requested_amount = models.DecimalField(max_digits=10, decimal_places=2)
    approved_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.SUBMITTED)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='aircover_claims_reviewed',
    )
    review_notes = models.TextField(blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'AirCover claim #{self.pk} on booking #{self.booking_id} ({self.status})'
