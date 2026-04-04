from django.urls import re_path
from .consumers import NotificationConsumer

# WebSocket URL for real-time notifications.
# The client connects to:  ws://your-domain/ws/notifications/
websocket_urlpatterns = [
    re_path(r'^ws/notifications/$', NotificationConsumer.as_asgi()),
]
