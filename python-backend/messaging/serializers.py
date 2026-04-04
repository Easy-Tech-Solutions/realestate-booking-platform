from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Conversation, Message, MessageAttachment

User = get_user_model()


class ParticipantSerializer(serializers.ModelSerializer):
    #Minimal user info shown inside a conversation or message
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'full_name']

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.email


class MessageAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = MessageAttachment
        fields = ['id', 'file_url', 'file_name', 'file_size', 'file_type', 'created_at']

    def get_file_url(self, obj):
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url


class MessageSerializer(serializers.ModelSerializer):
    sender = ParticipantSerializer(read_only=True)
    attachments = MessageAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Message
        fields = [
            'id', 'conversation', 'sender', 'content',
            'message_type', 'is_read', 'attachments', 'created_at'
        ]
        read_only_fields = ['id', 'sender', 'message_type', 'is_read', 'created_at']


class SendMessageSerializer(serializers.Serializer):
    #Used when sending a new message via the REST endpoint
    content = serializers.CharField(required=False, allow_blank=True, default='')
    files = serializers.ListField(
        child=serializers.FileField(),
        required=False,
        write_only=True
    )

    def validate(self, data):
        if not data.get('content') and not data.get('files'):
            raise serializers.ValidationError("A message must have text content or at least one file.")
        return data


class ConversationSerializer(serializers.ModelSerializer):
    participants = ParticipantSerializer(many=True, read_only=True)
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    listing_title = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = [
            'id', 'participants', 'listing', 'listing_title',
            'last_message', 'unread_count', 'created_at', 'updated_at'
        ]

    def get_last_message(self, obj):
        last = obj.messages.last()
        if last:
            return {
                'id': last.id,
                'content': last.content,
                'sender_email': last.sender.email,
                'created_at': last.created_at,
                'message_type': last.message_type,
            }
        return None

    def get_unread_count(self, obj):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            return obj.messages.filter(is_read=False).exclude(sender=request.user).count()
        return 0

    def get_listing_title(self, obj):
        return obj.listing.title if obj.listing else None


class StartConversationSerializer(serializers.Serializer):
    #Used to start a new conversation with another user
    recipient_id = serializers.IntegerField()
    listing_id = serializers.IntegerField(required=False, allow_null=True)
    initial_message = serializers.CharField(required=False, allow_blank=True, default='')
