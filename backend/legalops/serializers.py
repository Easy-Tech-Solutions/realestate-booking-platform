from rest_framework import serializers

from .models import LegalDocument


class LegalDocumentSerializer(serializers.ModelSerializer):
    document_key_display = serializers.CharField(source='get_document_key_display', read_only=True)
    published_by_username = serializers.CharField(source='published_by.username', default=None, read_only=True)

    class Meta:
        model = LegalDocument
        fields = [
            'id', 'document_key', 'document_key_display', 'version', 'effective_date',
            'summary_of_changes', 'body_sections', 'published_by', 'published_by_username', 'created_at',
        ]
        read_only_fields = ['id', 'document_key_display', 'published_by', 'published_by_username', 'created_at']
