from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import NotificationViewSet, NotificationPreferenceView

router = DefaultRouter()
router.register(r'', NotificationViewSet, basename='notification')

urlpatterns = [
    # Preferences endpoint (not a viewset action, lives at a fixed path)
    path('preferences/', NotificationPreferenceView.as_view(), name='notification-preferences'),
    # All other notification endpoints via router
    path('', include(router.urls)),
]
