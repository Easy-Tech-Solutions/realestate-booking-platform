from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from .models import Listing
from .serializers import ListingSerializer

@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def listings_collection(request):
    if request.method == "GET":
        items = Listing.objects.all().order_by("-created_at")
        return Response(ListingSerializer(items, many=True).data)
    if request.method == "POST":
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = ListingSerializer(data=request.data)
        if serializer.is_valid():
            listing = serializer.save()
            return Response(ListingSerializer(listing).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(["GET", "PUT", "DELETE"])
@permission_classes([AllowAny])
def listing_detail(request, id):
    try:
        item = Listing.objects.get(pk=id)
    except Listing.DoesNotExist:
        return Response({"error": "Listing not found"}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == "GET":
        return Response(ListingSerializer(item).data)
    
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    
    if request.method == "PUT":
        serializer = ListingSerializer(item, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(ListingSerializer(item).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    if request.method == "DELETE":
        item.delete()
        return Response({"message": "Listing deleted"}, status=status.HTTP_204_NO_CONTENT)

@api_view(["POST"])
@permission_classes([AllowAny])
def favorite_listing(request, id):
    # Placeholder - in real app, relate to user favorites
    return Response({"message": f"Listing {id} favorited."})
