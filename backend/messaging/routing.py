from django.urls import re_path
from . import consumers

# These are WebSocket URL patterns — registered separately from HTTP urls.py
# The client connects to:  ws://our-domain/ws/chat/<conversation_id>/
websocket_urlpatterns = [
    re_path(r'^ws/chat/(?P<conversation_id>\d+)/$', consumers.ChatConsumer.as_asgi()),
]
