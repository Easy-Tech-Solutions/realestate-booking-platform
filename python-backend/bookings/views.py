from rest_framework.decorators import api_view, permission_classes
<<<<<<< HEAD
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.utils import timezone
from datetime import timedelta 
from .models import Booking
from .serializers import BookingSerializer, BookingConfrimationSerializer, BookingCreateSerializer
from listings.models import Listing

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def bookings_collection(request):
    if request.method == "GET":
        # Customers see their bookings, owners see bookings for their properties
        if request.user.role in ['agent', 'admin']:
            # Owners see all bookings for their properties
            bookings = Booking.objects.filter(listing__owner=request.user)
        else:
            # Customers see their own bookings
            bookings = Booking.objects.filter(customer=request.user)
        
        bookings = bookings.order_by("-requested_at")
        serializer = BookingSerializer(bookings, many=True, context={'request': request})
        return Response(serializer.data)
         
    elif request.method == "POST":
        try:
            from listings.models import Listing
            listing = Listing.objects.get(pk=request.data.get('listing'))
                
                # Check if booking already exists
            existing_booking = Booking.objects.filter(
                    customer=request.user,
                    listing=listing,
                    start_date=request.data.get('start_date'),
                    end_date=request.data.get('end_date')
                ).first()
                
            if existing_booking:
                return Response({
                    'error': 'You already have a booking for this property on these dates',
                    'existing_booking_id': existing_booking.id
                }, status=status.HTTP_400_BAD_REQUEST)
                
            # Create new booking
            booking = Booking.objects.create(
                listing=listing,
                customer=request.user,
                start_date=request.data.get('start_date'),
                end_date=request.data.get('end_date'),
                notes=request.data.get('notes', '')
            )
                
            return Response(BookingSerializer(booking).data, status=status.HTTP_201_CREATED)
                
        except Listing.DoesNotExist:
            return Response({'error': 'Listing not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def booking_detail(request, id):
    try:
        booking = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({"error": "Booking not found"}, status=status.HTTP_404_NOT_FOUND)
    
    # Check permissions for all operations
    has_permission = (
        booking.customer == request.user or  # Booking owner
        booking.listing.owner == request.user or  # Listing owner
        request.user.is_staff or  # Admin
        request.user.is_superuser  # Superuser
    )
    
    if not has_permission:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == "GET":
        return Response(BookingSerializer(booking, context={'request': request}).data)
    
    elif request.method == "PUT":
        # Only booking owner can update (and admin)
        if booking.customer != request.user or not (request.user.is_staff or request.user.is_superuser):
            return Response({"error": "Only booking owner can update this booking"}, 
                           status=status.HTTP_403_FORBIDDEN)
        
        serializer = BookingSerializer(booking, data=request.data, partial=True, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(BookingSerializer(booking, context={'request': request}).data)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    elif request.method == "DELETE":
        booking.delete()
        return Response({"message": "Booking deleted"}, status=status.HTTP_204_NO_CONTENT)
    
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pending_bookings(request):
    'Get pending booking requests for property owners'
    if request.user.role not in ['agent', 'admin']:
        return Response({'error':'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    
    pending_bookings = Booking.objects.filter(listing__owner=request.user, status='requested').order_by('-requested_at')
    serializer = BookingSerializer(pending_bookings, many=True, context={'request':request})
    return Response(serializer.data)

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def confirm_booking(request,id):
    'Owner confirms a booking request'
    try:
        booking = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    #Check if user onws the listing
    if booking.listing.owner != request.user:
        return Response({'error':'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    
    if booking.status != 'requested':
        return Response({'error':'Booking cannot be confirmed'}, status=status.HTTP_400_BAD_REQUEST)

    #Update booking status
    booking.status = 'confirmed'
    booking.confirmed_at = timezone.now()
    booking.save()

    return Response(BookingSerializer(booking, context={'request':request}).data)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def decline_booking(request, id):
    'Owner declines a booking request'
    try:
        booking = Booking.objects.get(pk=id)

    except Booking.DoesNotExist:
        return Response({'error':'Booking not found'}, status=status.HTTP_404_NOT_FOUND)
    
    #Check if user owns the listing
    if booking.listing.owner != request.user:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
    
    if booking.status != 'requested':
        return Response({"error": "Booking cannot be declined"}, status=status.HTTP_400_BAD_REQUEST)
    
    #Update booking status
    serializer = BookingConfrimationSerializer(data=request.data)
    if serializer.is_valid():
        booking.status = 'declined'
        booking.declined_at = timezone.now()
        booking.owner_notes = serializer.validated_data.get('owner_notes', '')
        booking.decline_reason = serializer.validated_data.get('decline_reason', '')
        booking.save()

        return Response(BookingSerializer(booking, context={'request': request}).data)
    
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
=======
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from .models import Booking
from .serializers import BookingSerializer

@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def bookings_collection(request):
    if request.method == "GET":
        items = Booking.objects.all().order_by("-created_at")
        return Response(BookingSerializer(items, many=True).data)
    if request.method == "POST":
        serializer = BookingSerializer(data=request.data)
        if serializer.is_valid():
            booking = serializer.save()
            return Response(BookingSerializer(booking).data, status=201)
        return Response(serializer.errors, status=400)

@api_view(["GET"])
@permission_classes([AllowAny])
def booking_detail(request, id):
    try:
        item = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({"error": "not found"}, status=404)
    return Response(BookingSerializer(item).data)
>>>>>>> dalton
