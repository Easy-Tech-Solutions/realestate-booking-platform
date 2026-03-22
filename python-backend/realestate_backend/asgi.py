import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from django.conf import settings
from messaging.routing import websocket_urlpatterns as chat_ws_patterns
from notifications.routing import websocket_urlpatterns as notification_ws_patterns

websocket_urlpatterns = chat_ws_patterns + notification_ws_patterns

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'realestate_backend.settings')

# Initialize Django's HTTP application first — this triggers app registry setup
django_asgi_app = get_asgi_application()

# In production, wrap URLRouter with AllowedHostsOriginValidator to reject
# WebSocket connections from untrusted origins. In development we skip it
# because tools like Postman don't send an Origin header and would be
# rejected immediately, causing the connection to drop after ~1 second.
if settings.DEBUG:
    websocket_app = URLRouter(websocket_urlpatterns)  # noqa: combined list from above
else:
    from channels.security.websocket import AllowedHostsOriginValidator
    websocket_app = AllowedHostsOriginValidator(URLRouter(websocket_urlpatterns))

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': websocket_app,
})
