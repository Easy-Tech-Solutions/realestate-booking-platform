import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for a single conversation room.

    Connection URL:  ws://domain/ws/chat/<conversation_id>/

    After connecting send:
        { "type": "authenticate", "token": "<access_token>" }

    Then you can send:
        { "type": "chat_message",  "content": "Hello!" }
        { "type": "mark_read" }

    Server broadcasts:
        chat_message        — new message in room
        message_edited      — a message was edited
        read_receipt        — other participant opened/read the thread
    """

    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.room_group_name = f"chat_{self.conversation_id}"
        self.user = None
        await self.accept()

    async def disconnect(self, close_code):
        if self.user:
            await self.update_last_seen(self.user)
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            await self.send_error("Invalid JSON.")
            return

        msg_type = data.get('type')

        if msg_type == 'authenticate':
            await self.handle_authenticate(data)
        elif msg_type == 'chat_message':
            if not self.user:
                await self.send_error("Not authenticated.")
                return
            await self.handle_chat_message(data)
        elif msg_type == 'mark_read':
            if not self.user:
                await self.send_error("Not authenticated.")
                return
            await self.handle_mark_read()
        elif msg_type == 'typing':
            if not self.user:
                await self.send_error("Not authenticated.")
                return
            await self.handle_typing()
        else:
            await self.send_error(f"Unknown message type: {msg_type}")

    # ------------------------------------------------------------------ #
    #  Handlers                                                            #
    # ------------------------------------------------------------------ #

    async def handle_authenticate(self, data):
        token_str = data.get('token', '')
        user = await self.get_user_from_token(token_str)

        if user is None:
            await self.send_error("Invalid or expired token.")
            await self.close()
            return

        is_participant = await self.check_participant(user, self.conversation_id)
        if not is_participant:
            await self.send_error("You are not a participant in this conversation.")
            await self.close()
            return

        self.user = user
        await self.update_last_seen(user)

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)

        await self.send(text_data=json.dumps({
            'type': 'authenticated',
            'user_id': user.id,
            'email': user.email,
        }))

    async def handle_chat_message(self, data):
        content = data.get('content', '').strip()
        if not content:
            await self.send_error("Message content cannot be empty.")
            return

        message = await self.save_message(self.conversation_id, self.user, content)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',
                'message_id': message['id'],
                'content': message['content'],
                'sender_id': message['sender_id'],
                'sender_email': message['sender_email'],
                'conversation_id': int(self.conversation_id),
                'created_at': message['created_at'],
                'message_type': 'text',
                'has_attachments': False,
            }
        )

    async def handle_typing(self):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_typing',
                'user_id': self.user.id,
                'user_name': self.user.get_full_name() or self.user.email,
                'conversation_id': int(self.conversation_id),
            }
        )

    async def handle_mark_read(self):
        updated = await self.mark_messages_read(self.conversation_id, self.user)
        await self.send(text_data=json.dumps({'type': 'messages_marked_read'}))

        if updated:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'broadcast_read_receipt',
                    'conversation_id': int(self.conversation_id),
                    'reader_id': self.user.id,
                }
            )

    # ------------------------------------------------------------------ #
    #  Group broadcast handlers — called when group_send fires            #
    # ------------------------------------------------------------------ #

    async def broadcast_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message_id': event['message_id'],
            'content': event['content'],
            'sender_id': event['sender_id'],
            'sender_email': event['sender_email'],
            'conversation_id': event['conversation_id'],
            'created_at': event['created_at'],
            'message_type': event.get('message_type', 'text'),
            'has_attachments': event.get('has_attachments', False),
        }))

    async def broadcast_message_edited(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_edited',
            'message_id': event['message_id'],
            'content': event['content'],
            'edited_at': event['edited_at'],
            'conversation_id': event['conversation_id'],
        }))

    async def broadcast_read_receipt(self, event):
        await self.send(text_data=json.dumps({
            'type': 'read_receipt',
            'conversation_id': event['conversation_id'],
            'reader_id': event['reader_id'],
        }))

    async def broadcast_typing(self, event):
        # Don't echo typing back to the sender
        if self.user and event['user_id'] == self.user.id:
            return
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'user_id': event['user_id'],
            'user_name': event['user_name'],
            'conversation_id': event['conversation_id'],
        }))

    # ------------------------------------------------------------------ #
    #  Database helpers                                                    #
    # ------------------------------------------------------------------ #

    @database_sync_to_async
    def get_user_from_token(self, token_str):
        try:
            token = AccessToken(token_str)
            user_id = token['user_id']
            return User.objects.get(id=user_id)
        except (TokenError, InvalidToken, User.DoesNotExist, KeyError):
            return None

    @database_sync_to_async
    def check_participant(self, user, conversation_id):
        from .models import Conversation
        return Conversation.objects.filter(id=conversation_id, participants=user).exists()

    @database_sync_to_async
    def save_message(self, conversation_id, user, content):
        from .models import Conversation, Message
        conversation = Conversation.objects.get(id=conversation_id)
        msg = Message.objects.create(
            conversation=conversation,
            sender=user,
            content=content,
            message_type='text',
        )
        conversation.save(update_fields=['updated_at'])
        return {
            'id': msg.id,
            'content': msg.content,
            'sender_id': user.id,
            'sender_email': user.email,
            'created_at': msg.created_at.isoformat(),
        }

    @database_sync_to_async
    def mark_messages_read(self, conversation_id, user):
        from .models import Message
        return Message.objects.filter(
            conversation_id=conversation_id,
            is_read=False
        ).exclude(sender=user).update(is_read=True)

    @database_sync_to_async
    def update_last_seen(self, user):
        try:
            user.profile.last_seen = timezone.now()
            user.profile.save(update_fields=['last_seen'])
        except Exception:
            pass

    # ------------------------------------------------------------------ #
    #  Utility                                                             #
    # ------------------------------------------------------------------ #

    async def send_error(self, message):
        await self.send(text_data=json.dumps({'type': 'error', 'message': message}))
