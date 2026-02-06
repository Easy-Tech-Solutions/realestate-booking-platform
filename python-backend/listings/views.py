from rest_framework.decorators import api_view, parser_classes
from django.db import models
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser
from .models import Listing, ListingImage, Favorite
from .serializers import ListingSerializer, ListingImageCreateSerializer, FavoriteSerializer
from .filters import ListingFilter

@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser])
def listings_collection(request):
    if request.method == "GET":
        # Anyone can view listings - no authentication required
        items = ListingFilter(request.GET, queryset=Listing.objects.all())  #Filters the queryset
        return Response(ListingSerializer(items.qs, many=True, context={'request': request}).data)
         
    elif request.method == "POST":
        # Only authenticated users can create listings
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = ListingSerializer(data=request.data)
        if serializer.is_valid():
            # Set owner to current user
            listing = serializer.save(owner=request.user)
            return Response(ListingSerializer(listing, context={'request': request}).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(["GET", "PUT", "DELETE"])
def listing_detail(request, id):
    try:
        item = Listing.objects.get(pk=id)
    except Listing.DoesNotExist:
        return Response({"error": "Listing not found"}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == "GET":
        # Anyone can view individual listings - no authentication required
        return Response(ListingSerializer(item).data, context={'request':request})
    
    elif request.method == "PUT":
        # Only authenticated owners can update
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        if item.owner != request.user:
            return Response({"error": "Only the owner can update this listing"}, status=status.HTTP_403_FORBIDDEN)
        serializer = ListingSerializer(item, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(ListingSerializer(item).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    elif request.method == "DELETE":
        # Only authenticated owners can delete
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        if item.owner != request.user:
            return Response({"error": "Only the owner can delete this listing"}, status=status.HTTP_403_FORBIDDEN)
        item.delete()
        return Response({"message": "Listing deleted"}, status=status.HTTP_204_NO_CONTENT)

#New view for handling gallery images
@api_view(['GET','POST'])
def listing_images(request, listing_id):
    try:
        listing = Listing.objects.get(pk=listing_id)
    except Listing.DoesNotExist:
        return Response({'error':'Listing not found'}, status=status.HTTP_404_NOT_FOUND)
    
    if request.method == 'GET':
        images = listing.gallery_images.all()
        serializer = ListingImageCreateSerializer(images, many=True)
        return Response(serializer.data)

    elif request.method == 'POST':
        #Only authenticated owners can add images
        if not request.user.is_authenticated:
            return Response({'error':'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
        if listing.owner != request.user:
            return Response({'error':'Only the owner can add images'}, status=status.HTTP_403_FORBIDDEN)
        serializer = ListingImageCreateSerializer(data=request.data)
        if serializer.is_valid():
            #Auto-set the order if not provided
            if not serializer.validated_data.get('order'):
                max_order = listing.gallery.images.aggregate(models.Max('order'))['order__max'] or 0
                serializer.validated_data['order'] = max_order + 1
            image = serializer.save(listing=listing)
            return Response(ListingImageCreateSerializer(image).data, status=status.HTTP_201_CREATED)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

@api_view(['DELETE'])
def listing_image_detail(request, listing_id, image_id):
    try:
        listing = Listing.objects.get(pk=listing_id)
        image = listing.gallery_images.get(pk=image_id)
    except (Listing.DoesNotExist, ListingImage.DoesNotExist):
        return Response({'error':'Not Found'}, status=status.HTTP_404_NOT_FOUND)
    
    #Only authenticated onwers can delete images
    if not request.user.is_authenticated:
        return Response({'error':'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED) 
    if listing.owner != request.user:
        return Response({"error": "Only the owner can delete images"}, status=status.HTTP_403_FORBIDDEN)
    
    image.delete()
    return Response({'message':'Image deleted'}, status=status.HTTP_204_NO_CONTENT)

#View for user's collection of favorite listings
@api_view(['GET'])
def favorites_collection(request):
    #Only authenticated users can see their favorite listings
    if not request.user.is_authenticated:
        return Response({'error':'Authentication required'},status=status.HTTP_401_UNAUTHORIZED)
    
    favorites = (
        Favorite.objects.filter(user=request.user).select_related('listing','user').order_by('-created_at')
    )
    serializer = FavoriteSerializer(favorites, many=True, context={'request':request})
    return Response(serializer.data)

#View for accessing individual listing from favorites
@api_view(["POST", "DELETE"])
def favorite_listing(request, id):
    #Only authenticated users can create or delete their favorite listings
    if not request.user.is_authenticated:
        return Response({'error':'Authentication required'},status=status.HTTP_401_UNAUTHORIZED)
    
    listing = get_object_or_404(Listing, pk=id)

    if request.method == 'POST':
        favorite,created = Favorite.objects.get_or_create(user=request.user, listing=listing)
        serializer = FavoriteSerializer(favorite, context={'request':request})
        return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK) 

    if request.method == 'DELETE':
        Favorite.objects.filter(user=request.user, listing=listing).delete()
        return Response({'message':'Favorite listing deleted'},status=status.HTTP_204_NO_CONTENT)