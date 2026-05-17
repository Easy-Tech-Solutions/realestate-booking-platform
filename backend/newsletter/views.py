from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.core.validators import validate_email
from django.core.exceptions import ValidationError

from .models import Subscriber
from .serializers import SubscribeSerializer, SubscriberSerializer


def _is_admin(user):
    return user.is_authenticated and (getattr(user, 'role', None) == 'admin' or user.is_staff)


@api_view(['POST'])
@permission_classes([AllowAny])
def subscribe(request):
    """
    POST /api/newsletter/subscribe/
    Body: { email, first_name?, interests? }
    """
    serializer = SubscribeSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    email      = serializer.validated_data['email'].lower().strip()
    first_name = serializer.validated_data.get('first_name', '').strip()
    interests  = serializer.validated_data.get('interests', [])

    sub, created = Subscriber.objects.get_or_create(
        email=email,
        defaults={'first_name': first_name, 'interests': interests},
    )

    if not created:
        if sub.is_active:
            return Response(
                {'message': 'You are already subscribed.'},
                status=status.HTTP_200_OK,
            )
        # Re-subscribe
        sub.is_active = True
        sub.unsubscribed_at = None
        if first_name:
            sub.first_name = first_name
        if interests:
            sub.interests = interests
        sub.save(update_fields=['is_active', 'unsubscribed_at', 'first_name', 'interests'])
        return Response(
            {'message': 'Welcome back! You have been re-subscribed.'},
            status=status.HTTP_200_OK,
        )

    return Response(
        {'message': 'Thank you for subscribing! You will receive updates about new listings, hotels, and exclusive deals.'},
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def unsubscribe(request):
    """
    POST /api/newsletter/unsubscribe/
    Body: { token } — uses the unsubscribe_token from the email link
    """
    token = request.data.get('token', '').strip()
    if not token:
        return Response({'error': 'Token is required.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        sub = Subscriber.objects.get(unsubscribe_token=token)
    except Subscriber.DoesNotExist:
        return Response({'error': 'Invalid unsubscribe link.'}, status=status.HTTP_404_NOT_FOUND)

    if not sub.is_active:
        return Response({'message': 'You are already unsubscribed.'}, status=status.HTTP_200_OK)

    sub.unsubscribe()
    return Response({'message': 'You have been unsubscribed successfully.'}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def subscriber_list(request):
    """
    GET /api/newsletter/subscribers/  — admin only
    Query params: ?active=true|false
    """
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    qs = Subscriber.objects.all()
    active_param = request.query_params.get('active')
    if active_param == 'true':
        qs = qs.filter(is_active=True)
    elif active_param == 'false':
        qs = qs.filter(is_active=False)

    return Response({
        'total':       qs.count(),
        'active':      Subscriber.objects.filter(is_active=True).count(),
        'unsubscribed': Subscriber.objects.filter(is_active=False).count(),
        'subscribers': SubscriberSerializer(qs[:200], many=True).data,
    })
