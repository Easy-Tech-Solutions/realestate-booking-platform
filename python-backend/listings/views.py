from rest_framework.decorators import api_view, parser_classes
from django.db import models
from django.db.models import Avg, Count, Sum, Q
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from rest_framework import status
from django.utils import timezone
from datetime import timedelta, date
from collections import defaultdict
from rest_framework.parsers import MultiPartParser, FormParser
from .models import Listing, ListingImage, Favorite, Review, ReviewImage, PropertyView, PropertyStats
from bookings.models import Booking
from .serializers import ListingSerializer, ListingImageCreateSerializer, FavoriteSerializer, ReviewSerializer, ReviewImageSerializer, ReviewCreateSerializer
from .filters import ListingFilter
from django.contrib.auth import get_user_model
User = get_user_model()

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
        return Response(ListingSerializer(item, context={'request':request}).data)
    
    elif request.method == "PUT":
        # Only authenticated owners can update
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        
        if item.owner != request.user and not request.user.is_superuser:
            return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
        
        serializer = ListingSerializer(item, data=request.data, partial=True, context={'request': request})
        if serializer.is_valid():
            serializer.save()
            return Response(ListingSerializer(item, context={'request': request}).data)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    elif request.method == "DELETE":
        # Only authenticated owners can delete
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        if item.owner != request.user and not request.user.is_superuser:
            return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
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


#Get all reivews for a specific listing
@api_view(['GET'])
def listing_reviews(request, listing_id):
    listing = get_object_or_404(Listing, pk=listing_id)
    reviews = Review.objects.filter(listing=listing)
    serializer = ReviewSerializer(reviews, many=True, context={'request':request})
    return Response(serializer.data)

#Create a review
@api_view(['POST'])
def create_review(request):
    if not request.user.is_authenticated:
        return Response({'error':'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
    
    try:
        # Get listing
        listing = get_object_or_404(Listing, pk=request.data.get('listing'))
        
        # Create review
        review = Review.objects.create(
            listing=listing,
            reviewer=request.user,
            rating=int(request.data.get('rating')),
            title=request.data.get('title', ''),
            content=request.data.get('content', '')
        )
        
        # Return response
        serializer = ReviewSerializer(review, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)
        
    except Listing.DoesNotExist:
        return Response({'error': 'Listing not found'}, status=status.HTTP_404_NOT_FOUND)
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

#View, update or delete a specific review
@api_view(['GET','PUT','DELETE'])
def review_detail(request, id):
    if not request.user.is_authenticated:
        return Response({'error':'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
    
    review = get_object_or_404(pk=id)

    if request.method == 'GET':
        serializer = ReviewSerializer(review, context={'request':request})
        return Response(serializer.data)
    
    #Only reviewer can update/delete
    if review.reviewer != request.user and not request.user.is_superuser:
        return Response({'error':'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    
    if request.method == 'PUT':
        serializer = ReviewSerializer(review, data=request.data, partial=True, context={'reuest':request})
        if serializer.is_valid:
            serializer.save()
            return Response(serializer.data)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    if request.method == 'DELETE':
        review.delete()
        return Response({'message':'Review deleted'}, status=status.HTTP_204_NO_CONTENT)
    
#Get all reviews by a specific user
@api_view(['GET'])
def user_reviews(request, user_id):
    user = get_object_or_404(get_user_model(), pk=user_id)
    reviews = Review.objects.filter(reviewer=user)
    serializer = ReviewSerializer(reviews, many=True, context={'request':request})
    return Response(serializer.data)

#Get detailed stats for a specific listing
@api_view(['GET'])
def listing_stats(request, listing_id):
    listing = get_object_or_404(Listing, pk=listing_id)

    #Check permissions(Only onwer or superuser(admin) can see stats)
    if listing.owner != request.user and not request.user.is_superuser:
        return Response({'error':'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    
    #Date range(last 30 days by default)
    days = int(request.GET.get('days', 30))
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    #Basic stats
    total_views = PropertyView.objects.filter(listing=listing).count()
    unique_views = PropertyView.objects.filter(listing=listing).values('ip_address').distinct().count()
    total_favorites = Favorite.objects.filter(listing=listing).count()
    total_bookings = Booking.objects.filter(listing=listing).count()
    total_revenue = Booking.objects.filter(listing=listing, status='comfirmed').aggregate(total=Sum('listing__price'))['total'] or 0

    #Daily stats
    daily_stats = PropertyStats.objects.filter(listing=listing, date__gte=start_date, date__lte = end_date).order_by('date')

    #Conversion rates(percentages)
    view_to_favorite_rate = (total_favorites / total_views * 100) if total_views > 0 else 0
    view_to_booking_rate = (total_bookings / total_views * 100) if total_views > 0 else 0

    return Response({
        'listing':{
            'id': listing.id,
            'title': listing.title,
            'price': str(listing.price),
        },
        'summary':{
            'total_views': total_views,
            'unique_views': unique_views,
            'total_favorites': total_favorites,
            'total_bookings': total_bookings,
            'total_revenue':str(total_revenue),
            'view_to_favorite_rate': round(view_to_favorite_rate, 2),
            'view_to_booking_rate': round(view_to_booking_rate, 2),
        },
        'daily_stats':[{
            'date': stat.date.isoformat(),
            'views': stat.views,
            'unique_views': stat.unique_views,
            'favorites': stat.favorites,
            'bookings': stat.bookings,
            'revenue': str(stat.revenue),
        }
        for stat in daily_stats
        ],
        'period':{
            'start_date':start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'days': days,
        }
    })

#Get comprehensive for an agent/property owner
@api_view(['GET'])
def agent_analytics(request):
    if not request.user.is_authenticated:
        return Response({'error': 'Authentication required'}, status=status.HTTP_401_UNAUTHORIZED)
    
    user = request.user

    #Only agents and admin can see analytics
    if user.role not in ['agent', 'admin']:
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
    
    #Date range
    days = int(request.GET.get('days',30))
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    #Get all listings for this agent
    listings = Listing.objects.filter(owner=user)

    #Overall stats
    total_listings = listings.count()
    total_views = PropertyView.objects.filter(listing__in=listings).count()
    total_favorites = Favorite.objects.filter(listing__in=listings).count()
    total_bookings = Booking.objects.filter(listing__in=listings).count()
    total_revenue = Booking.objects.filter(listing__in=listings,status='comfirmed').aggregate(total=Sum('listing__price'))['total'] or 0

    #Per-property stats
    property_stats = []
    for listing in listings:
        views = PropertyView.objects.filter(listing=listing).count()
        favorites = Favorite.objects.filter(listing=listing).count()
        bookings = Booking.objects.filter(listing=listing).count()
        revenue = Booking.objects.filter(listing=listing, status='comfirmed').aggregate(total=Sum('listing__price'))['total'] or 0

        property_stats.append({
            'id': listing.id,
            'title': listing.title,
            'price': str(listing.price),
            'views': views,
            'favorites': favorites,
            'bookings': bookings,
            'revenue': str(revenue),
        })

    #Sort by revenue(descending order)
    property_stats.sort(key=lambda x: float(x['revenue']), reverse=True)

    return Response({
        'agent':{
            'id': user.id,
            'username': user.username,
            'role': user.role,
        },
        'summary':{
            'total_listings':total_listings,
            'total_views': total_views,
            'total_favorites': total_favorites,
            'total_bookings': total_bookings,
            'total_revenue': str(total_revenue),
        },
        'property_performance': property_stats,
        'period':{
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'days': days,
        }
    })

#Get most viewed listings site-wide(public endpoint)
@api_view(['GET'])
def popular_listings(request):
    days = int(request.GET.get('days',7))
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    #Get view counts for listings
    view_counts = PropertyView.objects.filter(timestamp__date__gte=start_date,timestamp__date__lte=end_date).values('listing').annotate(view_count=Count('id')).order_by('-view_count')[:20]

    popular_listings = []
    for item in view_counts:
        listing = Listing.objects.get(pk=item['listing'])
        favorite_count = Favorite.objects.filter(listing=listing).count()

        popular_listings.append({
            'id': listing.id,
            'title': listing.title,
            'price': str(listing.price),
            'property_type': listing.property_type,
            'address': listing.address,
            'main_image_url': listing.main_image.url if listing.main_image else None,
            'owner_username': listing.owner.username,
            'views': item['view_count'],
            'favorites': favorite_count,
        })
    
    return Response({
        'popular_listings': popular_listings,
        'period':{
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'days': days
        }
    })