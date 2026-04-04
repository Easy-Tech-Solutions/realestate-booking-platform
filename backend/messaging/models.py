from django.db import models
from django.conf import settings


class Conversation(models.Model):
    """
    A conversation thread between two or more users.
    Optionally linked to a specific property listing (e.g. a renter
    asking an owner about a property).
    """
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='conversations',
        help_text="All users who are part of this conversation."
    )
    listing = models.ForeignKey(
        'listings.Listing',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='conversations',
        help_text="Optional: the property this conversation is about."
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        names = ', '.join(p.get_full_name() or p.email for p in self.participants.all())
        return f"Conversation [{names}]"


class Message(models.Model):
    """
    A single message inside a conversation.
    Can be plain text, or a file-only message when an attachment is uploaded.
    """
    MESSAGE_TYPES = [
        ('text', 'Text'),
        ('file', 'File'),
        ('text_file', 'Text with File'),
    ]

    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='messages'
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sent_messages'
    )
    content = models.TextField(
        blank=True,
        help_text="The text body of the message. Can be empty if only a file is attached."
    )
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPES, default='text')
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"Message by {self.sender.email} at {self.created_at:%Y-%m-%d %H:%M}"


class MessageAttachment(models.Model):
    """
    A file attached to a message — photo, video, document, etc.
    One message can have multiple attachments.
    """
    FILE_TYPES = [
        ('image', 'Image'),
        ('video', 'Video'),
        ('document', 'Document'),
        ('other', 'Other'),
    ]

    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name='attachments'
    )
    file = models.FileField(upload_to='messaging/attachments/%Y/%m/')
    file_name = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField(help_text="File size in bytes.")
    file_type = models.CharField(max_length=10, choices=FILE_TYPES, default='other')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Attachment: {self.file_name} ({self.file_type})"
