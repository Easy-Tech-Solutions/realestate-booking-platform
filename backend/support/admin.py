from django.contrib import admin

from .models import ContactInquiry, SupportTicket, TicketAttachment, TicketMessage, AirCoverClaim


class TicketMessageInline(admin.TabularInline):
    model = TicketMessage
    extra = 0
    readonly_fields = ['sender', 'sender_name', 'is_staff_reply', 'content', 'created_at']
    can_delete = False


class TicketAttachmentInline(admin.TabularInline):
    model = TicketAttachment
    extra = 0
    readonly_fields = ['file', 'filename', 'file_size', 'content_type', 'uploaded_by', 'created_at']
    can_delete = False


@admin.register(SupportTicket)
class SupportTicketAdmin(admin.ModelAdmin):
    list_display = ['ticket_number', 'subject', 'category', 'status', 'priority', 'assigned_to', 'created_at']
    list_filter = ['status', 'priority', 'category']
    search_fields = ['ticket_number', 'subject', 'description', 'user__username', 'user__email', 'guest_email']
    readonly_fields = ['ticket_number', 'created_at', 'updated_at', 'sla_due_at', 'escalated_at', 'escalated_by', 'escalation_notes']
    inlines = [TicketMessageInline, TicketAttachmentInline]


@admin.register(ContactInquiry)
class ContactInquiryAdmin(admin.ModelAdmin):
    list_display = ['name', 'email', 'category', 'subject', 'is_read', 'created_at']
    list_filter = ['category', 'is_read']
    search_fields = ['name', 'email', 'subject', 'message']


@admin.register(AirCoverClaim)
class AirCoverClaimAdmin(admin.ModelAdmin):
    list_display = ['id', 'booking', 'claimant', 'claim_type', 'requested_amount', 'status', 'created_at']
    list_filter = ['claim_type', 'status']
    search_fields = ['claimant__username', 'description']
