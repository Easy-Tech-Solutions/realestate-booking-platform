from django.contrib import admin
from .models import Conversation, Message, MessageAttachment


class MessageInline(admin.TabularInline):
    model = Message
    extra = 0
    readonly_fields = ['sender', 'content', 'message_type', 'is_read', 'created_at']
    can_delete = False


class MessageAttachmentInline(admin.TabularInline):
    model = MessageAttachment
    extra = 0
    readonly_fields = ['file', 'file_name', 'file_size', 'file_type', 'created_at']
    can_delete = False


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ['id', 'listing', 'participant_list', 'created_at', 'updated_at']
    list_filter = ['created_at']
    readonly_fields = ['created_at', 'updated_at']
    inlines = [MessageInline]

    def participant_list(self, obj):
        return ', '.join(p.email for p in obj.participants.all())
    participant_list.short_description = 'Participants'


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['id', 'conversation', 'sender', 'message_type', 'is_read', 'created_at']
    list_filter = ['message_type', 'is_read', 'created_at']
    readonly_fields = ['created_at']
    inlines = [MessageAttachmentInline]


@admin.register(MessageAttachment)
class MessageAttachmentAdmin(admin.ModelAdmin):
    list_display = ['id', 'message', 'file_name', 'file_type', 'file_size', 'created_at']
    list_filter = ['file_type']
    readonly_fields = ['created_at']
