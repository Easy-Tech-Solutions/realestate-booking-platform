import os
from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.db.models import Q
from django.shortcuts import get_object_or_404
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Conversation, Message, MessageAttachment
from .serializers import (
    ConversationSerializer,
    MessageSerializer,
    SendMessageSerializer,
    StartConversationSerializer,
)


def _detect_file_type(file):
    #Determine the category of an uploaded file from its MIME type or extension
    content_type = getattr(file, 'content_type', '') or ''
    if content_type.startswith('image/'):
        return 'image'
    if content_type.startswith('video/'):
        return 'video'
    ext = os.path.splitext(file.name)[1].lower()
    if ext in ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx']:
        return 'document'
    if ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']:
        return 'image'
    if ext in ['.mp4', '.mov', '.avi', '.mkv', '.webm']:
        return 'video'
    return 'other'


class ConversationListView(generics.ListAPIView):
    """
    Returns all conversations the authenticated user participates in,
    ordered by most recently updated (newest message first).
    """
    serializer_class = ConversationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Conversation.objects
            .filter(participants=self.request.user)
            .prefetch_related('participants', 'messages')
            .select_related('listing')
        )


class StartConversationView(APIView):
    """"
    If a conversation between the requester and recipient (for the same listing) already
    exists, it is returned instead of creating a duplicate.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = StartConversationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        recipient_id = serializer.validated_data['recipient_id']
        listing_id = serializer.validated_data.get('listing_id')
        initial_message = serializer.validated_data.get('initial_message', '').strip()

        if recipient_id == request.user.id:
            return Response(
                {"detail": "You cannot start a conversation with yourself."},
                status=status.HTTP_400_BAD_REQUEST
            )

        from django.contrib.auth import get_user_model
        User = get_user_model()
        recipient = get_object_or_404(User, id=recipient_id)

        # Look for an existing conversation between these two users for this listing
        existing = (
            Conversation.objects
            .filter(participants=request.user)
            .filter(participants=recipient)
            .filter(listing_id=listing_id)
            .first()
        )

        if existing:
            out = ConversationSerializer(existing, context={'request': request})
            return Response(out.data, status=status.HTTP_200_OK)

        # Create a fresh conversation
        conversation = Conversation.objects.create(listing_id=listing_id)
        conversation.participants.add(request.user, recipient)

        # Optionally send the first message right away
        if initial_message:
            Message.objects.create(
                conversation=conversation,
                sender=request.user,
                content=initial_message,
                message_type='text',
            )

        out = ConversationSerializer(conversation, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)


class MessageListView(generics.ListAPIView):
    """
    Returns all messages in the conversation (oldest first).
    Automatically marks all received messages as read.
    """
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        conversation_id = self.kwargs['conversation_id']
        # Ensure the user is a participant — raises 404 otherwise
        get_object_or_404(
            Conversation,
            id=conversation_id,
            participants=self.request.user
        )
        return (
            Message.objects
            .filter(conversation_id=conversation_id)
            .select_related('sender')
            .prefetch_related('attachments')
        )

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        # Mark all incoming messages as read when the user opens the thread
        Message.objects.filter(
            conversation_id=self.kwargs['conversation_id'],
            is_read=False
        ).exclude(sender=request.user).update(is_read=True)
        return response


class SendMessageView(APIView):
    """
    Supports multipart/form-data to carry both text and file attachments.

    Form fields:
        content   (string, optional if files are attached)
        files     (one or more file fields, optional)
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, conversation_id):
        conversation = get_object_or_404(
            Conversation,
            id=conversation_id,
            participants=request.user
        )

        serializer = SendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        content = serializer.validated_data.get('content', '').strip()
        uploaded_files = request.FILES.getlist('files')

        # Determine the message type
        if content and uploaded_files:
            msg_type = 'text_file'
        elif uploaded_files:
            msg_type = 'file'
        else:
            msg_type = 'text'

        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=content,
            message_type=msg_type,
        )

        # Save each uploaded file as a separate attachment record
        for f in uploaded_files:
            MessageAttachment.objects.create(
                message=message,
                file=f,
                file_name=f.name,
                file_size=f.size,
                file_type=_detect_file_type(f),
            )

        # Bump conversation so it appears at the top of all participants' inboxes
        conversation.save(update_fields=['updated_at'])

        # Push a real-time notification through the channel layer so any
        # connected WebSocket clients receive the new message instantly.
        # If Redis is unavailable the message is still saved — we just
        # skip the live push rather than returning a 500 to the client.
        channel_layer = get_channel_layer()
        if channel_layer:
            try:
                async_to_sync(channel_layer.group_send)(
                    f"chat_{conversation_id}",
                    {
                        'type': 'broadcast_message',
                        'message_id': message.id,
                        'content': message.content,
                        'sender_id': request.user.id,
                        'sender_email': request.user.email,
                        'conversation_id': conversation.id,
                        'created_at': message.created_at.isoformat(),
                        'message_type': msg_type,
                    }
                )
            except Exception:
                # Redis is down or unreachable — the message is saved,
                # real-time delivery is skipped until Redis comes back.
                pass

        out = MessageSerializer(message, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)


class UnreadCountView(APIView):
    """
    Returns total number of unread messages across all conversations.
    Useful for showing a badge in the UI.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = Message.objects.filter(
            conversation__participants=request.user,
            is_read=False
        ).exclude(sender=request.user).count()
        return Response({'unread_count': count})
