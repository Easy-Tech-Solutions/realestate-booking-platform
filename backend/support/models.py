from django.db import models
from django.conf import settings
from django.utils import timezone
import random
import string


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

    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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
