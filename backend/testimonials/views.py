from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status

from .models import Testimonial
from .serializers import TestimonialSerializer, TestimonialCreateSerializer


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

# Moderation (update/delete) moved to the generic admin CRUD system
# (RBAC resource 'marketing.testimonials', see superadmin.generic_admin).
