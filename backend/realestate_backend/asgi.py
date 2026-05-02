import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'realestate_backend.settings')
django.setup()

from django.core.asgi import get_asgi_application
from django.conf import settings
from channels.routing import ProtocolTypeRouter, URLRouter
from messaging.routing import websocket_urlpatterns as chat_ws_patterns
from notifications.routing import websocket_urlpatterns as notification_ws_patterns

websocket_urlpatterns = chat_ws_patterns + notification_ws_patterns

# Initialize Django's HTTP application
django_asgi_app = get_asgi_application()

if settings.DEBUG:
    websocket_app = URLRouter(websocket_urlpatterns)
else:
    from channels.security.websocket import AllowedHostsOriginValidator
    websocket_app = AllowedHostsOriginValidator(URLRouter(websocket_urlpatterns))

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': websocket_app,
})
