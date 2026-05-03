from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.shortcuts import get_object_or_404
from django.db.models import Q
from django.utils import timezone
from .models import Booking, SavedSearch, SearchAlert, PropertyComparison, ComparisonItem
from .serializers import (
    BookingSerializer, BookingConfrimationSerializer, BookingCreateSerializer,
    SearchAlertSerializer, SavedSearchSerializer, SavedSearchCreateSerializer,
    PropertyComparisonSerializer, ComparisonCreateSerializer, ComparisonItemSerializer
)
from listings.models import Listing
from listings.serializers import ListingSerializer
from django.db.models import Avg as _Avg


def _check_superhost(owner):
    """Auto-assign Superhost badge if owner meets criteria."""
    try:
        from listings.models import Review as _Review
        total = Booking.objects.filter(
            listing__owner=owner, status__in=['confirmed', 'completed']
        ).count()
        if total < 10:
            return
        avg = _Review.objects.filter(listing__owner=owner).aggregate(avg=_Avg('rating'))['avg'] or 0
        responded = Booking.objects.filter(
            listing__owner=owner, status__in=['confirmed', 'declined']
        ).count()
        total_requests = Booking.objects.filter(
            listing__owner=owner,
            status__in=['requested', 'confirmed', 'declined', 'completed']
        ).count()
        response_rate = (responded / total_requests * 100) if total_requests > 0 else 0
        qualifies = avg >= 4.8 and response_rate >= 90
        profile = owner.profile
        if profile.is_superhost != qualifies:
            profile.is_superhost = qualifies
            profile.save()
    except Exception:
        pass


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def bookings_collection(request):
    if request.method == "GET":
        if request.user.role in ['agent', 'admin']:
            bookings = Booking.objects.filter(listing__owner=request.user)
        else:
            bookings = Booking.objects.filter(customer=request.user)
        bookings = bookings.order_by("-requested_at")
        return Response(BookingSerializer(bookings, many=True, context={'request': request}).data)

    elif request.method == "POST":
        try:
            listing = Listing.objects.get(pk=request.data.get('listing'))

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

            serializer = BookingCreateSerializer(data=request.data)
            if serializer.is_valid():
                start = serializer.validated_data['start_date']
                end = serializer.validated_data['end_date']
                nights = max((end - start).days, 1)
                total_price = listing.price * nights
                booking = serializer.save(customer=request.user, total_price=total_price)
                # Instant book: auto-confirm if listing is set to instant
                if listing.booking_mode == 'instant':
                    booking.status = 'confirmed'
                    booking.confirmed_at = timezone.now()
                    booking.save(update_fields=['status', 'confirmed_at'])
                return Response(BookingSerializer(booking, context={'request': request}).data, status=status.HTTP_201_CREATED)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

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

    has_permission = (
        booking.customer == request.user or
        booking.listing.owner == request.user or
        request.user.is_staff or
        request.user.is_superuser
    )

    if not has_permission:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "GET":
        return Response(BookingSerializer(booking, context={'request': request}).data)

    elif request.method == "PUT":
        if booking.customer != request.user and not (request.user.is_staff or request.user.is_superuser):
            return Response({"error": "Only booking owner can update this booking"}, status=status.HTTP_403_FORBIDDEN)
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
    if request.user.role not in ['agent', 'admin']:
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    bookings = Booking.objects.filter(listing__owner=request.user, status='requested').order_by('-requested_at')
    return Response(BookingSerializer(bookings, many=True, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def confirm_booking(request, id):
    try:
        booking = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    if booking.listing.owner != request.user:
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    if booking.status != 'requested':
        return Response({'error': 'Booking cannot be confirmed'}, status=status.HTTP_400_BAD_REQUEST)

    booking.status = 'confirmed'
    booking.confirmed_at = timezone.now()
    booking.save()

    # Superhost check: auto-assign if owner meets criteria
    _check_superhost(booking.listing.owner)

    return Response(BookingSerializer(booking, context={'request': request}).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def decline_booking(request, id):
    try:
        booking = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    if booking.listing.owner != request.user:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    if booking.status != 'requested':
        return Response({"error": "Booking cannot be declined"}, status=status.HTTP_400_BAD_REQUEST)

    serializer = BookingConfrimationSerializer(data=request.data)
    if serializer.is_valid():
        booking.status = 'declined'
        booking.declined_at = timezone.now()
        booking.owner_notes = serializer.validated_data.get('owner_notes', '')
        booking.decline_reason = serializer.validated_data.get('decline_reason', '')
        booking.save()
        return Response(BookingSerializer(booking, context={'request': request}).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def saved_searches(request):
    if request.method == 'GET':
        searches = SavedSearch.objects.filter(user=request.user, is_active=True)
        return Response(SavedSearchSerializer(searches, many=True, context={'request': request}).data)

    elif request.method == 'POST':
        serializer = SavedSearchCreateSerializer(data=request.data)
        if serializer.is_valid():
            search = serializer.save(user=request.user)
            return Response(SavedSearchSerializer(search, context={'request': request}).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['PUT', 'GET', 'DELETE'])
@permission_classes([IsAuthenticated])
def saved_search_detail(request, id):
    try:
        search = SavedSearch.objects.get(pk=id, user=request.user)
    except SavedSearch.DoesNotExist:
        return Response({'error': 'Saved search not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(SavedSearchSerializer(search, context={'request': request}).data)

    elif request.method == 'PUT':
        serializer = SavedSearchCreateSerializer(search, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(SavedSearchSerializer(search, context={'request': request}).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        search.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def search_alerts(request):
    alerts = SearchAlert.objects.filter(saved_search__user=request.user)
    return Response(SearchAlertSerializer(alerts, many=True, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def test_search(request):
    query = Q()
    if request.data.get('min_price'):
        query &= Q(price__gte=request.data['min_price'])
    if request.data.get('max_price'):
        query &= Q(price__lte=request.data['max_price'])
    if request.data.get('property_type'):
        query &= Q(property_type=request.data['property_type'])
    if request.data.get('min_bedrooms'):
        query &= Q(bedrooms__gte=request.data['min_bedrooms'])
    if request.data.get('max_bedrooms'):
        query &= Q(bedrooms__lte=request.data['max_bedrooms'])
    if request.data.get('address'):
        query &= Q(address__icontains=request.data['address'])
    if request.data.get('keywords'):
        query &= Q(title__icontains=request.data['keywords']) | Q(description__icontains=request.data['keywords'])
    if request.data.get('is_available') is not None:
        query &= Q(is_available=request.data['is_available'])

    listings = Listing.objects.filter(query)
    return Response(ListingSerializer(listings, many=True, context={'request': request}).data)


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def property_comparisons(request):
    if request.method == 'GET':
        comparisons = PropertyComparison.objects.filter(user=request.user)
        return Response(PropertyComparisonSerializer(comparisons, many=True, context={'request': request}).data)

    elif request.method == 'POST':
        serializer = ComparisonCreateSerializer(data=request.data)
        if serializer.is_valid():
            listing_ids = serializer.validated_data.pop('listing_ids')
            comparison = serializer.save(user=request.user)
            for order, listing_id in enumerate(listing_ids):
                try:
                    listing = Listing.objects.get(pk=listing_id)
                    ComparisonItem.objects.create(comparison=comparison, listing=listing, order=order)
                except Listing.DoesNotExist:
                    continue
            return Response(PropertyComparisonSerializer(comparison, context={'request': request}).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['GET', 'PUT', 'DELETE'])
@permission_classes([IsAuthenticated])
def comparison_detail(request, id):
    try:
        comparison = PropertyComparison.objects.get(pk=id, user=request.user)
    except PropertyComparison.DoesNotExist:
        return Response({'error': 'Comparison not found'}, status=status.HTTP_404_NOT_FOUND)

    if request.method == 'GET':
        return Response(PropertyComparisonSerializer(comparison, context={'request': request}).data)

    elif request.method == 'PUT':
        serializer = ComparisonCreateSerializer(comparison, data=request.data, partial=True)
        if serializer.is_valid():
            if 'listing_ids' in serializer.validated_data:
                listing_ids = serializer.validated_data.pop('listing_ids')
                comparison.items.all().delete()
                for order, listing_id in enumerate(listing_ids):
                    try:
                        listing = Listing.objects.get(pk=listing_id)
                        ComparisonItem.objects.create(comparison=comparison, listing=listing, order=order)
                    except Listing.DoesNotExist:
                        continue
            serializer.save()
            return Response(PropertyComparisonSerializer(comparison, context={'request': request}).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        comparison.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
def shared_comparison(request, token):
    try:
        comparison = PropertyComparison.objects.get(share_token=token, is_public=True)
    except PropertyComparison.DoesNotExist:
        return Response({'error': 'Shared comparison not found or expired'}, status=status.HTTP_404_NOT_FOUND)
    return Response(PropertyComparisonSerializer(comparison, context={'request': request}).data)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def add_to_comparison(request):
    comparison_id = request.data.get('comparison_id')
    listing_id = request.data.get('listing_id')
    try:
        comparison = PropertyComparison.objects.get(pk=comparison_id, user=request.user)
        listing = Listing.objects.get(pk=listing_id)
        if comparison.items.filter(listing=listing).exists():
            return Response({'error': 'Property already in comparison'}, status=status.HTTP_400_BAD_REQUEST)
        next_order = comparison.items.count()
        ComparisonItem.objects.create(comparison=comparison, listing=listing, order=next_order)
        return Response(PropertyComparisonSerializer(comparison, context={'request': request}).data)
    except (PropertyComparison.DoesNotExist, Listing.DoesNotExist):
        return Response({'error': 'Comparison or property not found'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def remove_from_comparison(request):
    comparison_id = request.data.get('comparison_id')
    listing_id = request.data.get('listing_id')
    try:
        comparison = PropertyComparison.objects.get(pk=comparison_id, user=request.user)
        listing = Listing.objects.get(pk=listing_id)
        comparison_item = comparison.items.get(listing=listing)
        comparison_item.delete()
        for i, item in enumerate(comparison.items.all()):
            item.order = i
            item.save()
        return Response(PropertyComparisonSerializer(comparison, context={'request': request}).data)
    except (PropertyComparison.DoesNotExist, Listing.DoesNotExist, ComparisonItem.DoesNotExist):
        return Response({'error': 'Comparison, property or item not found'}, status=status.HTTP_404_NOT_FOUND)
