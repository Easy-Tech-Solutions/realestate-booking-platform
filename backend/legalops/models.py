from django.conf import settings
from django.db import models


class LegalDocument(models.Model):
    """A version of a platform legal document. `body_sections` holds the
    actual content — [{title, intro?, content: str | [str], outro?}, ...] —
    the same shape Terms.tsx/Privacy.tsx already rendered from a hardcoded
    array; that array now lives here so Legal Ops can publish a new version
    (with a real change to what's shown) instead of only recording metadata
    about a change someone else made in the frontend source."""

    class DocumentKey(models.TextChoices):
        TERMS_OF_SERVICE = 'terms_of_service', 'Terms of Service'
        PRIVACY_POLICY = 'privacy_policy', 'Privacy Policy'

    document_key = models.CharField(max_length=30, choices=DocumentKey.choices, db_index=True)
    version = models.CharField(max_length=30, help_text='e.g. "2026-07-12" or "v3"')
    effective_date = models.DateField()
    summary_of_changes = models.TextField(blank=True)
    body_sections = models.JSONField(
        default=list, blank=True,
        help_text='[{"title": "...", "intro": "...", "content": "..." | ["...", "..."], "outro": "..."}, ...]',
    )
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='legal_documents_published',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-effective_date', '-created_at']
        constraints = [
            models.UniqueConstraint(fields=['document_key', 'version'], name='unique_document_version'),
        ]

    def __str__(self):
        return f'{self.get_document_key_display()} {self.version} (effective {self.effective_date})'
