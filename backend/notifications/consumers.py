"""
WebSocket consumer for real-time notification delivery.

Connection URL
--------------
    ws://your-domain/ws/notifications/

Authentication
--------------
The client must send a JWT token immediately after connecting:
    { "type": "authenticate", "token": "<access_token>" }

Once authenticated the consumer:
  - Joins the group  notifications_<user_id>
  - Forwards any  notification_message  events sent to that group
    directly down to the browser as JSON

The service layer (notifications/services.py) calls
    channel_layer.group_send('notifications_<user_id>', {...})
which triggers notification_message() here and pushes the payload
to the connected tab instantly.

Client can also request a badge count refresh:
    { "type": "get_unread_count" }
"""

import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

User = get_user_model()


class NotificationConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.user = None
        self.group_name = None
        await self.accept()

    async def disconnect(self, close_code):
        if self.group_name:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            await self._send_error('Invalid JSON.')
            return

        msg_type = data.get('type')

        if msg_type == 'authenticate':
            await self._handle_authenticate(data)
        elif msg_type == 'get_unread_count':
            if not self.user:
                await self._send_error('Not authenticated.')
                return
            await self._handle_unread_count()
        else:
            await self._send_error(f'Unknown message type: {msg_type}')

    # ------------------------------------------------------------------ #
    #  Handlers                                                            #
    # ------------------------------------------------------------------ #

    async def _handle_authenticate(self, data):
        token_str = data.get('token', '')
        user = await self._get_user_from_token(token_str)

        if user is None:
            await self._send_error('Invalid or expired token.')
            await self.close()
            return

        self.user       = user
        self.group_name = f'notifications_{user.id}'

        await self.channel_layer.group_add(self.group_name, self.channel_name)

        await self.send(text_data=json.dumps({
            'type':    'authenticated',
            'user_id': user.id,
            'email':   user.email,
        }))

        # Send the current unread count right away so the badge is accurate
        await self._handle_unread_count()

    async def _handle_unread_count(self):
        count = await self._get_unread_count(self.user)
        await self.send(text_data=json.dumps({
            'type':  'unread_count',
            'count': count,
        }))

    # ------------------------------------------------------------------ #
    #  Group event handler — called by channel_layer.group_send           #
    # ------------------------------------------------------------------ #

    async def notification_message(self, event):
        """
        Forward a notification pushed by services._push_realtime() to the
        connected WebSocket client.
        """
        payload = event['notification']
        # Include an updated unread count so the client badge stays in sync
        count   = await self._get_unread_count(self.user) if self.user else 0

        await self.send(text_data=json.dumps({
            'type':         'new_notification',
            'notification': payload,
            'unread_count': count,
        }))

    # ------------------------------------------------------------------ #
    #  Database helpers                                                    #
    # ------------------------------------------------------------------ #

    @database_sync_to_async
    def _get_user_from_token(self, token_str):
        try:
            token   = AccessToken(token_str)
            user_id = token['user_id']
            return User.objects.get(id=user_id)
        except (TokenError, InvalidToken, User.DoesNotExist, KeyError):
            return None

    @database_sync_to_async
    def _get_unread_count(self, user):
        from .models import Notification
        return Notification.objects.filter(user=user, is_read=False).count()

    # ------------------------------------------------------------------ #
    #  Utility                                                             #
    # ------------------------------------------------------------------ #

    async def _send_error(self, message: str):
        await self.send(text_data=json.dumps({'type': 'error', 'message': message}))
