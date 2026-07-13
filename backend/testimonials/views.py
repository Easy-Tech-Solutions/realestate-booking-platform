from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Testimonial
from .serializers import TestimonialSerializer, TestimonialCreateSerializer


def _is_admin(user):
    """Full admins always pass; is_staff accounts need a custom role
    granting marketing.testimonials directly. Being merely is_staff (e.g. a
    finance-only admin) is not enough — that was the previous, overly
    broad behavior here."""
    if not user.is_authenticated:
        return False
    from rbac.permissions import is_full_admin, has_any_permission
    return is_full_admin(user) or has_any_permission(user, 'marketing.testimonials')


@api_view(['GET', 'POST'])
@permission_classes([AllowAny])
def testimonials_collection(request):
    if request.method == 'GET':
        qs = Testimonial.objects.filter(is_active=True)
        return Response(TestimonialSerializer(qs, many=True).data)

    # POST — authenticated users only
    if not request.user.is_authenticated:
        return Response(
            {'error': 'You must be signed in to share a testimonial.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    serializer = TestimonialCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    d = serializer.validated_data

    # Build display name from user's profile
    user = request.user
    full_name = f'{user.first_name} {user.last_name}'.strip() or user.username

    t = Testimonial.objects.create(
        user=user,
        name=full_name,
        location=d.get('location', ''),
        rating=d['rating'],
        quote=d['quote'],
    )
    return Response(TestimonialSerializer(t).data, status=status.HTTP_201_CREATED)


@api_view(['PUT', 'DELETE'])
def testimonial_detail(request, pk):
    if not _is_admin(request.user):
        return Response({'error': 'Admin access required.'}, status=status.HTTP_403_FORBIDDEN)

    try:
        t = Testimonial.objects.get(pk=pk)
    except Testimonial.DoesNotExist:
        return Response({'error': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'DELETE':
        t.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = TestimonialSerializer(t, data=request.data, partial=True)
    if serializer.is_valid():
        serializer.save()
        return Response(serializer.data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
