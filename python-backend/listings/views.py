from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from .models import Listing
from .serializers import ListingSerializer

@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def listings_collection(request):
    if request.method == "GET":
        items = Listing.objects.all().order_by("-created_at")
        return Response(ListingSerializer(items, many=True).data)
    if request.method == "POST":
        serializer = ListingSerializer(data=request.data)
        if serializer.is_valid():
            listing = serializer.save()
            return Response(ListingSerializer(listing).data, status=201)
        return Response(serializer.errors, status=400)

@api_view(["GET"])
@permission_classes([AllowAny])
def listing_detail(request, id):
    try:
        item = Listing.objects.get(pk=id)
    except Listing.DoesNotExist:
        return Response({"error": "not found"}, status=404)
    return Response(ListingSerializer(item).data)

@api_view(["POST"])
@permission_classes([AllowAny])
def favorite_listing(request, id):
    # Placeholder - in real app, relate to user favorites
    return Response({"message": f"Listing {id} favorited."})
