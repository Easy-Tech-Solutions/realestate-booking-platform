import os
from datetime import timedelta
from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Conversation, Message, MessageAttachment
from .redaction import redact_contact_info


def _attachments_allowed(conversation, user):
    """Attachments are only allowed inside a conversation tied to a listing
    where the two participants already have a confirmed (or completed)
    booking together.

    Rationale: the bypass incentive is highest *before* a booking exists.
    Once the booking is locked in we've earned our commission, so the
    trust-and-safety risk of contact-card screenshots drops sharply.
    """
    if not conversation.listing_id:
        return False

    from bookings.models import Booking
    participant_ids = list(conversation.participants.values_list('id', flat=True))
    return Booking.objects.filter(
        listing_id=conversation.listing_id,
        status__in=['confirmed', 'completed'],
        customer_id__in=participant_ids,
    ).exists()
from .serializers import (
    ConversationSerializer,
    MessageSerializer,
    SendMessageSerializer,
    StartConversationSerializer,
)

MESSAGE_EDIT_WINDOW = timedelta(minutes=3)


def _detect_file_type(file):
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


def _broadcast(conversation_id, payload):
    """Push a message to the conversation's channel group, silently failing if Redis is down."""
    channel_layer = get_channel_layer()
    if channel_layer:
        try:
            async_to_sync(channel_layer.group_send)(f"chat_{conversation_id}", payload)
        except Exception:
            pass


class ConversationListView(generics.ListAPIView):
    serializer_class = ConversationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            Conversation.objects
            .filter(participants=self.request.user)
            .exclude(deleted_by=self.request.user)
            .prefetch_related('participants', 'messages')
            .select_related('listing')
        )


class StartConversationView(APIView):
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

        existing = (
            Conversation.objects
            .filter(participants=request.user)
            .filter(participants=recipient)
            .filter(listing_id=listing_id)
            .first()
        )

        if existing:
            # Re-show a conversation the user had previously deleted
            existing.deleted_by.remove(request.user)
            out = ConversationSerializer(existing, context={'request': request})
            return Response(out.data, status=status.HTTP_200_OK)

        conversation = Conversation.objects.create(listing_id=listing_id)
        conversation.participants.add(request.user, recipient)

        if initial_message:
            Message.objects.create(
                conversation=conversation,
                sender=request.user,
                content=initial_message,
                message_type='text',
            )

        out = ConversationSerializer(conversation, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)


class DeleteConversationView(APIView):
    """Soft-delete a conversation for the requesting user (other participant keeps it)."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, conversation_id):
        conversation = get_object_or_404(
            Conversation,
            id=conversation_id,
            participants=request.user,
        )
        conversation.deleted_by.add(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageListView(generics.ListAPIView):
    serializer_class = MessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        conversation_id = self.kwargs['conversation_id']
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
        conversation_id = self.kwargs['conversation_id']
        updated = Message.objects.filter(
            conversation_id=conversation_id,
            is_read=False
        ).exclude(sender=request.user).update(is_read=True)

        if updated:
            _broadcast(conversation_id, {
                'type': 'broadcast_read_receipt',
                'conversation_id': int(conversation_id),
                'reader_id': request.user.id,
            })
        return response


class SendMessageView(APIView):
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

        # Block attachments until the two participants have a confirmed booking.
        if uploaded_files and not _attachments_allowed(conversation, request.user):
            return Response(
                {
                    'detail': 'Attachments are only available after a booking is confirmed.',
                    'code': 'attachments_not_allowed',
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        # Strip phone numbers / emails before persisting; the frontend uses
        # `was_redacted` to show the sender a one-time educational nudge.
        content, was_redacted = redact_contact_info(content)

        if content and uploaded_files:
            msg_type = 'text_file'
        elif uploaded_files:
            msg_type = 'file'
        else:
            msg_type = 'text'

        reply_to_id = request.data.get('reply_to_id')
        reply_to = None
        if reply_to_id:
            try:
                reply_to = Message.objects.get(id=reply_to_id, conversation=conversation)
            except Message.DoesNotExist:
                pass

        message = Message.objects.create(
            conversation=conversation,
            sender=request.user,
            content=content,
            message_type=msg_type,
            reply_to=reply_to,
        )

        attachments = []
        for f in uploaded_files:
            att = MessageAttachment.objects.create(
                message=message,
                file=f,
                file_name=f.name,
                file_size=f.size,
                file_type=_detect_file_type(f),
            )
            attachments.append({
                'id': att.id,
                'file_name': att.file_name,
                'file_size': att.file_size,
                'file_type': att.file_type,
            })

        conversation.save(update_fields=['updated_at'])
        # When a deleted-by user receives a new message the conversation resurfaces
        conversation.deleted_by.remove(*conversation.deleted_by.all())

        _broadcast(conversation_id, {
            'type': 'broadcast_message',
            'message_id': message.id,
            'content': message.content,
            'sender_id': request.user.id,
            'sender_email': request.user.email,
            'conversation_id': conversation.id,
            'created_at': message.created_at.isoformat(),
            'message_type': msg_type,
            'has_attachments': bool(attachments),
        })

        out = MessageSerializer(message, context={'request': request})
        payload = dict(out.data)
        payload['was_redacted'] = was_redacted
        return Response(payload, status=status.HTTP_201_CREATED)


class EditMessageView(APIView):
    """PATCH to edit own message content within the 3-minute window."""
    permission_classes = [IsAuthenticated]

    def patch(self, request, message_id):
        message = get_object_or_404(Message, id=message_id, sender=request.user)

        if timezone.now() - message.created_at > MESSAGE_EDIT_WINDOW:
            return Response(
                {"detail": "Messages can only be edited within 3 minutes of sending."},
                status=status.HTTP_403_FORBIDDEN,
            )

        new_content = (request.data.get('content') or '').strip()
        if not new_content:
            return Response({"detail": "Content cannot be empty."}, status=status.HTTP_400_BAD_REQUEST)

        message.content = new_content
        message.edited_at = timezone.now()
        message.save(update_fields=['content', 'edited_at'])

        _broadcast(message.conversation_id, {
            'type': 'broadcast_message_edited',
            'message_id': message.id,
            'content': message.content,
            'edited_at': message.edited_at.isoformat(),
            'conversation_id': message.conversation_id,
        })

        out = MessageSerializer(message, context={'request': request})
        return Response(out.data)


class UserPresenceView(APIView):
    """GET presence info for a user — is online if last_seen within 2 minutes."""
    permission_classes = [IsAuthenticated]

    def get(self, request, user_id):
        from django.contrib.auth import get_user_model
        User = get_user_model()
        target = get_object_or_404(User, id=user_id)
        try:
            last_seen = target.profile.last_seen
        except Exception:
            last_seen = None

        online = (
            last_seen is not None and
            timezone.now() - last_seen < timedelta(minutes=2)
        )
        return Response({
            'user_id': user_id,
            'online': online,
            'last_seen': last_seen,
        })


class UnreadCountView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = Message.objects.filter(
            conversation__participants=request.user,
            is_read=False
        ).exclude(sender=request.user).count()
        return Response({'unread_count': count})
