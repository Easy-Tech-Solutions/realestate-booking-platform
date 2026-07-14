import uuid
from django.db import models
from django.conf import settings


class ChatSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name='chatbot_sessions',
    )
    # Fingerprint for anonymous users so the widget can resume a session
    # across page navigations within the same browser tab.
    session_key = models.CharField(max_length=64, blank=True, db_index=True)
    handed_off = models.BooleanField(default=False)
    handoff_ticket = models.ForeignKey(
        'support.SupportTicket', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='chatbot_session',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'ChatSession {self.id} ({"user " + str(self.user_id) if self.user_id else "anon"})'


class ChatMessage(models.Model):
    ROLE_USER = 'user'
    ROLE_BOT = 'bot'
    ROLE_CHOICES = [(ROLE_USER, 'User'), (ROLE_BOT, 'Bot')]

    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=4, choices=ROLE_CHOICES)
    content = models.TextField()
    # True when the bot signalled it cannot answer and suggested handoff
    suggested_handoff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'[{self.role}] {self.content[:60]}'
