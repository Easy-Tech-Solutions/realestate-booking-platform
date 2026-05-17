from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import NotificationViewSet, NotificationPreferenceView, device_token, vapid_public_key

router = DefaultRouter()
router.register(r'', NotificationViewSet, basename='notification')

urlpatterns = [
    path('preferences/', NotificationPreferenceView.as_view(), name='notification-preferences'),
    path('device-token/', device_token, name='device-token'),
    path('vapid-public-key/', vapid_public_key, name='vapid-public-key'),
    path('', include(router.urls)),
]
