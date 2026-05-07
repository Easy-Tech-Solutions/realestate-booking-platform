from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet
from rest_framework.mixins import ListModelMixin, DestroyModelMixin, RetrieveModelMixin

from .models import Notification, NotificationPreference, DeviceToken
from .serializers import NotificationSerializer, NotificationPreferenceSerializer


class NotificationViewSet(
    ListModelMixin,
    RetrieveModelMixin,
    DestroyModelMixin,
    GenericViewSet,
 ):
    
    serializer_class   = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)

        # Optional filter: ?is_read=true / false
        is_read = self.request.query_params.get('is_read')
        if is_read is not None:
            qs = qs.filter(is_read=is_read.lower() == 'true')

        # Optional filter by type: ?type=booking_confirmed
        notif_type = self.request.query_params.get('type')
        if notif_type:
            qs = qs.filter(notification_type=notif_type)

        return qs

    # ---- Custom actions -----------------------------------------------

    @action(detail=True, methods=['post'], url_path='read')
    def read(self, request, pk=None):
        notification = self.get_object()
        notification.mark_read()
        return Response(NotificationSerializer(notification).data)

    @action(detail=True, methods=['patch'], url_path='unread')
    def mark_unread(self, request, pk=None):
        notification = self.get_object()
        notification.is_read = False
        notification.read_at = None
        notification.save(update_fields=['is_read', 'read_at'])
        return Response(NotificationSerializer(notification).data)

    @action(detail=False, methods=['post'], url_path='read-all')
    def read_all(self, request):
        #Mark all of the current user's unread notifications as read.
        now = timezone.now()
        updated = Notification.objects.filter(
            user=request.user, is_read=False
        ).update(is_read=True, read_at=now)
        return Response({'marked_read': updated})

    @action(detail=False, methods=['get'], url_path='unread-count')
    def unread_count(self, request):
        #Return the count of unread notifications (for badge display)
        count = Notification.objects.filter(user=request.user, is_read=False).count()
        return Response({'unread_count': count})


@api_view(['GET'])
@permission_classes([AllowAny])
def vapid_public_key(request):
    """Return the VAPID public key so the frontend can subscribe to push."""
    key = getattr(settings, 'VAPID_PUBLIC_KEY', None)
    if not key:
        return Response({'error': 'Push notifications not configured'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({'public_key': key})


@api_view(['POST', 'DELETE'])
@permission_classes([IsAuthenticated])
def device_token(request):
    """Register or unregister a Web Push subscription for the current user."""
    endpoint = request.data.get('endpoint', '').strip()
    p256dh = request.data.get('p256dh', '').strip()
    auth_key = request.data.get('auth', '').strip()
    device_type = request.data.get('device_type', 'web')

    if not endpoint:
        return Response({'error': 'endpoint is required'}, status=status.HTTP_400_BAD_REQUEST)

    if request.method == 'POST':
        if not p256dh or not auth_key:
            return Response({'error': 'p256dh and auth are required'}, status=status.HTTP_400_BAD_REQUEST)
        _, created = DeviceToken.objects.update_or_create(
            user=request.user,
            endpoint=endpoint,
            defaults={'p256dh': p256dh, 'auth': auth_key, 'device_type': device_type},
        )
        return Response({'status': 'registered'}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    DeviceToken.objects.filter(user=request.user, endpoint=endpoint).delete()
    return Response({'status': 'unregistered'}, status=status.HTTP_200_OK)


class NotificationPreferenceView(APIView):
    
    permission_classes = [IsAuthenticated]

    def _get_prefs(self, user):
        prefs, _ = NotificationPreference.objects.get_or_create(user=user)
        return prefs

    def get(self, request):
        prefs = self._get_prefs(request.user)
        return Response(NotificationPreferenceSerializer(prefs).data)

    def patch(self, request):
        prefs = self._get_prefs(request.user)
        serializer = NotificationPreferenceSerializer(
            prefs,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
