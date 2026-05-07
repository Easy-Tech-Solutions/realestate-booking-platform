import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError, InvalidToken

User = get_user_model()


class ChatConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for a single conversation room.

    Connection URL pattern:
        ws://your-domain/ws/chat/<conversation_id>/

    The client MUST send a JWT access token immediately after connecting
    (within the first message) as:
        { "type": "authenticate", "token": "<access_token>" }

    Once authenticated, the client can send:
        { "type": "chat_message", "content": "Hello!" }

    The server broadcasts to the room:
        {
            "type": "chat_message",
            "message_id": 42,
            "content": "Hello!",
            "sender_id": 5,
            "sender_email": "user@example.com",
            "conversation_id": 3,
            "created_at": "2026-03-15T10:00:00Z"
        }
    """

    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.room_group_name = f"chat_{self.conversation_id}"
        self.user = None  # Will be set after authentication message

        # Accept the connection immediately; we authenticate via first message
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        #Handle incoming messages from the WebSocket client
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            await self.send_error("Invalid JSON.")
            return

        msg_type = data.get('type')

        # --- Authentication handshake ---
        if msg_type == 'authenticate':
            await self.handle_authenticate(data)

        # --- Regular chat message ---
        elif msg_type == 'chat_message':
            if not self.user:
                await self.send_error("Not authenticated.")
                return
            await self.handle_chat_message(data)

        # --- Mark messages as read ---
        elif msg_type == 'mark_read':
            if not self.user:
                await self.send_error("Not authenticated.")
                return
            await self.handle_mark_read()

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

        # Make sure this user is actually a participant
        is_participant = await self.check_participant(user, self.conversation_id)
        if not is_participant:
            await self.send_error("You are not a participant in this conversation.")
            await self.close()
            return

        self.user = user

        # Join the channel group now that we know the user is valid
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

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

        # Broadcast to all connected clients in the group (including sender)
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'broadcast_message',   # maps to broadcast_message() below
                'message_id': message['id'],
                'content': message['content'],
                'sender_id': message['sender_id'],
                'sender_email': message['sender_email'],
                'conversation_id': int(self.conversation_id),
                'created_at': message['created_at'],
                'message_type': 'text',
            }
        )

    async def handle_mark_read(self):
        await self.mark_messages_read(self.conversation_id, self.user)
        await self.send(text_data=json.dumps({'type': 'messages_marked_read'}))

    # ------------------------------------------------------------------ #
    #  Group broadcast handler — called when group_send fires             #
    # ------------------------------------------------------------------ #

    async def broadcast_message(self, event):
        """Forward a group-sent message to the individual WebSocket client."""
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message_id': event['message_id'],
            'content': event['content'],
            'sender_id': event['sender_id'],
            'sender_email': event['sender_email'],
            'conversation_id': event['conversation_id'],
            'created_at': event['created_at'],
            'message_type': event.get('message_type', 'text'),
        }))

    # ------------------------------------------------------------------ #
    #  Database helpers (must be async via database_sync_to_async)        #
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
        return Conversation.objects.filter(
            id=conversation_id,
            participants=user
        ).exists()

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
        # Bump conversation updated_at so it sorts to top of inbox
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
        Message.objects.filter(
            conversation_id=conversation_id,
            is_read=False
        ).exclude(sender=user).update(is_read=True)

    # ------------------------------------------------------------------ #
    #  Utility                                                             #
    # ------------------------------------------------------------------ #

    async def send_error(self, message):
        await self.send(text_data=json.dumps({'type': 'error', 'message': message}))
