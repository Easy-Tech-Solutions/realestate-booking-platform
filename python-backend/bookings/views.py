from rest_framework.decorators import api_view, permission_classes
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
