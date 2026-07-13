from django.contrib import admin

from .models import LegalDocument


@admin.register(LegalDocument)
class LegalDocumentAdmin(admin.ModelAdmin):
    list_display = ['document_key', 'version', 'effective_date', 'published_by', 'created_at']
    list_filter = ['document_key']
    search_fields = ['version', 'summary_of_changes']
