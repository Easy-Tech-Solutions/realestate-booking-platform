from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from .serializers import PublicUserSerializer, UserSerializer
from listings.models import Listing, Favorite
from listings.serializers import ListingSerializer, FavoriteSerializer 
from bookings.models import Booking
from bookings.serializers import BookingSerializer
from django.contrib.auth import get_user_model

User = get_user_model()


@api_view(["GET"])
@permission_classes([AllowAny])

def users_collection(request):

    items = User.objects.all().order_by("id")

    return Response(PublicUserSerializer(items, many=True).data)



@api_view(["GET"])

@permission_classes([AllowAny])

def user_detail(request, id):

    try:

        u = User.objects.get(pk=id)

    except User.DoesNotExist:

        return Response({"error": "not found"}, status=404)

    return Response(PublicUserSerializer(u).data)

#User dashboard view 
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_dashboard(request):
    user = request.user

    my_listings = Listing.objects.filter(owner=user).order_by('-created_at')
    bookings_as_customer = Booking.objects.filter(customer=user).order_by('-created_at')
    bookings_on_my_listings = Booking.objects.filter(listing__owner=user).order_by('-created_at')

    favorites = (
        Favorite.objects.filter(user=user).select_related('listing').order_by('-created_at')
    )

    return Response({
        'user': UserSerializer(user).data,
        'listings': ListingSerializer(my_listings, many=True, context={'request':request}).data,
        'bookings_as_customer': BookingSerializer(bookings_as_customer, many=True).data,
        'bookings_on_my_listings': BookingSerializer(bookings_on_my_listings, many=True).data,
        'favorites': FavoriteSerializer(favorites, many=True, context = {'request':request}).data,
    })

