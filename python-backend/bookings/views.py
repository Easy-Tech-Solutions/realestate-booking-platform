from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from .models import Booking
from .serializers import BookingSerializer

@api_view(["GET", "POST"])
def bookings_collection(request):
    if request.method == "GET":
        # Users can only see their own bookings
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        items = Booking.objects.filter(customer=request.user).order_by("-created_at")
        return Response(BookingSerializer(items, many=True).data)
         
    elif request.method == "POST":
        # Only authenticated users can create bookings
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = BookingSerializer(data=request.data)
        if serializer.is_valid():
            # Set customer to current user
            booking = serializer.save(customer=request.user)
            return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(["GET", "PUT", "DELETE"])
def booking_detail(request, id):
    try:
        item = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({"error": "Booking not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check permissions for all operations
    has_permission = (
        item.customer == request.user or  # Booking owner
        item.listing.owner == request.user or  # Listing owner
        request.user.is_staff or  # Admin
        request.user.is_superuser  # Superuser
    )
    
    if not has_permission:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == "GET":
        return Response(BookingSerializer(item).data)
    
    elif request.method == "PUT":
        # Only booking owner can update (and admin)
        if item.customer != request.user or not (request.user.is_staff or request.user.is_superuser):
            return Response({"error": "Only booking owner can update this booking"}, status=status.HTTP_403_FORBIDDEN)
        serializer = BookingSerializer(item, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(BookingSerializer(item).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    elif request.method == "DELETE":
        item.delete()
        return Response({"message": "Booking deleted"}, status=status.HTTP_204_NO_CONTENT)
        
