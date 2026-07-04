import logging

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from realestate_backend.app_logging import log_activity, log_transaction

logger = logging.getLogger(__name__)
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import Booking, PaymentRequest, SavedSearch, SearchAlert, PropertyComparison, ComparisonItem
from .serializers import (
    BookingSerializer, BookingConfrimationSerializer, BookingCreateSerializer,
    SearchAlertSerializer, SavedSearchSerializer, SavedSearchCreateSerializer,
    PropertyComparisonSerializer, ComparisonCreateSerializer, ComparisonItemSerializer
)
from listings.models import Listing
from listings.serializers import ListingSerializer
from listings.models import HotelRoom
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
        # Always return the requester's bookings as a guest (what /trips shows).
        # Agents access bookings on their *listings* via the host dashboard
        # endpoint (/api/users/me/dashboard/), which is a separate, role-aware
        # surface — so this endpoint doesn't need to branch on role.
        bookings = Booking.objects.filter(customer=request.user).order_by("-requested_at")
        return Response(BookingSerializer(bookings, many=True, context={'request': request}).data)

    elif request.method == "POST":
        try:
            serializer = BookingCreateSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                # Lock the listing row so concurrent booking requests queue up
                # rather than racing through the availability check simultaneously.
                listing = Listing.objects.select_for_update().get(
                    pk=request.data.get('listing')
                )

                start        = serializer.validated_data['start_date']
                end          = serializer.validated_data['end_date']
                hotel_room   = serializer.validated_data.get('hotel_room')
                stripe_pi_id = serializer.validated_data.get('stripe_payment_intent_id')
                payment_method = serializer.validated_data.pop('payment_method', 'mtn_momo')

                # Declined and cancelled bookings do not block re-booking.
                existing_booking = Booking.objects.filter(
                    customer=request.user,
                    listing=listing,
                    start_date=start,
                    end_date=end,
                ).exclude(status__in=['declined', 'cancelled']).first()

                if existing_booking:
                    return Response({
                        'error': 'You already have a booking for this property on these dates',
                        'existing_booking_id': existing_booking.id
                    }, status=status.HTTP_400_BAD_REQUEST)

                if hotel_room:
                    if hotel_room.listing_id != listing.id:
                        return Response({'error': 'Room does not belong to this listing'}, status=status.HTTP_400_BAD_REQUEST)
                    from listings.views import _get_available_room_count
                    if _get_available_room_count(hotel_room, start, end) < 1:
                        return Response({'error': 'Room not available for selected dates'}, status=status.HTTP_400_BAD_REQUEST)
                else:
                    # For non-hotel listings, reject if another confirmed booking
                    # already overlaps the requested dates (half-open interval).
                    conflict = Booking.objects.filter(
                        listing=listing,
                        status='confirmed',
                        start_date__lt=end,
                        end_date__gt=start,
                    ).exists()
                    if conflict:
                        return Response(
                            {'error': 'This property is already booked for the selected dates'},
                            status=status.HTTP_409_CONFLICT,
                        )

                # Stripe payments: require and verify PI before creating booking.
                # MoMo: booking is created first, payment initiated after.
                from django.conf import settings as _settings
                if payment_method == 'stripe' and not stripe_pi_id:
                    return Response(
                        {'error': 'stripe_payment_intent_id is required for Stripe payments'},
                        status=status.HTTP_402_PAYMENT_REQUIRED,
                    )

                if stripe_pi_id:
                    try:
                        import stripe as _stripe
                        _stripe.api_key = getattr(_settings, 'STRIPE_SECRET_KEY', '')
                        intent = _stripe.PaymentIntent.retrieve(stripe_pi_id)
                    except Exception:
                        return Response({'error': 'Could not verify payment'}, status=status.HTTP_400_BAD_REQUEST)

                    if intent.status != 'succeeded':
                        return Response({'error': 'Payment has not been completed'}, status=status.HTTP_402_PAYMENT_REQUIRED)

                    # Replay check — this PI must not be linked to any other booking.
                    if Booking.objects.filter(stripe_payment_intent_id=stripe_pi_id).exists():
                        return Response({'error': 'Payment has already been used for another booking'}, status=status.HTTP_409_CONFLICT)

                    # Amount check — PI amount must match the canonical booking price.
                    from listings.views import compute_listing_pricing as _pricing_fn
                    _pricing   = _pricing_fn(listing, start, end, room=hotel_room)
                    _BOOKING_FEE_CENTS = 300
                    expected_cents = round((_pricing['discounted_subtotal'] + _pricing['service_fee']) * 100) + _BOOKING_FEE_CENTS
                    if intent.amount != expected_cents:
                        return Response(
                            {'error': f'Payment amount mismatch (expected {expected_cents} cents)'},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                # Compute the full grand total so it matches what the guest saw.
                from listings.views import compute_listing_pricing
                pricing = compute_listing_pricing(listing, start, end, room=hotel_room)
                total_price = round(pricing["total"], 2)
                booking = serializer.save(customer=request.user, total_price=total_price)
                # Instant book: auto-confirm if listing is set to instant
                if listing.booking_mode == 'instant':
                    booking.status = 'confirmed'
                    booking.confirmed_at = timezone.now()
                    booking.save(update_fields=['status', 'confirmed_at'])
                log_activity(
                    request, 'booking_created',
                    resource_type='booking', resource_id=booking.id,
                    listing_id=listing.id,
                    start_date=str(start), end_date=str(end),
                    status=booking.status,
                )
                return Response(BookingSerializer(booking, context={'request': request}).data, status=status.HTTP_201_CREATED)

        except Listing.DoesNotExist:
            return Response({'error': 'Listing not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def booking_detail(request, id):
    try:
        # Scope the lookup to bookings this user is allowed to see before fetching.
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
        # Return 404 rather than 403 to avoid leaking that the booking exists.
        return Response({"error": "Booking not found"}, status=status.HTTP_404_NOT_FOUND)

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

    # 'pending' is legacy data from the original migration (before the model
    # default was changed to 'requested'); accept both so old bookings can
    # still be actioned.
    if booking.status not in ('requested', 'pending'):
        return Response({'error': 'Booking cannot be confirmed'}, status=status.HTTP_400_BAD_REQUEST)

    booking.status = 'confirmed'
    booking.confirmed_at = timezone.now()
    booking.save()

    # Superhost check: auto-assign if owner meets criteria
    _check_superhost(booking.listing.owner)

    log_activity(
        request, 'booking_confirmed',
        resource_type='booking', resource_id=booking.id,
        listing_id=booking.listing_id, customer_id=booking.customer_id,
    )
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

    if booking.status not in ('requested', 'pending'):
        return Response({"error": "Booking cannot be declined"}, status=status.HTTP_400_BAD_REQUEST)

    serializer = BookingConfrimationSerializer(data=request.data)
    if serializer.is_valid():
        booking.status = 'declined'
        booking.declined_at = timezone.now()
        booking.owner_notes = serializer.validated_data.get('owner_notes', '')
        booking.decline_reason = serializer.validated_data.get('decline_reason', '')
        booking.save()
        log_activity(
            request, 'booking_declined',
            resource_type='booking', resource_id=booking.id,
            listing_id=booking.listing_id, customer_id=booking.customer_id,
            reason=booking.decline_reason,
        )
        return Response(BookingSerializer(booking, context={'request': request}).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def request_payment(request, id):
    """Owner sends a payment request to the guest after agreeing on terms."""
    try:
        booking = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    if booking.listing.owner != request.user:
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    if booking.status != 'requested':
        return Response(
            {'error': f'Cannot send payment request for a booking in "{booking.status}" status.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if hasattr(booking, 'payment_request'):
        return Response({'error': 'A payment request has already been sent for this booking.'}, status=status.HTTP_400_BAD_REQUEST)

    amount = request.data.get('amount')
    notes = request.data.get('notes', '')
    if not amount:
        return Response({'error': 'amount is required'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        from decimal import Decimal, InvalidOperation
        amount_decimal = Decimal(str(amount))
        if amount_decimal <= 0:
            raise ValueError
    except (InvalidOperation, ValueError):
        return Response({'error': 'amount must be a positive number'}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        PaymentRequest.objects.create(
            booking=booking,
            amount=amount_decimal,
            notes=notes,
            created_by=request.user,
        )
        booking.status = 'payment_requested'
        booking.save(update_fields=['status'])

    log_transaction(
        'payment_request_sent',
        user_id=request.user.id,
        booking_id=booking.id,
        amount=amount_decimal,
        gateway='platform',
    )
    return Response(BookingSerializer(booking, context={'request': request}).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_payment_requests(request):
    """Return pending payment requests for the authenticated guest."""
    requests = PaymentRequest.objects.filter(
        booking__user=request.user,
        is_paid=False,
    ).select_related('booking', 'booking__listing', 'created_by')
    data = [
        {
            'id': pr.id,
            'booking_id': pr.booking_id,
            'listing_title': pr.booking.listing.title,
            'amount': str(pr.amount),
            'currency': pr.currency,
            'notes': pr.notes,
            'created_at': pr.created_at.isoformat(),
            'owner_name': f'{pr.created_by.first_name} {pr.created_by.last_name}'.strip() or pr.created_by.username,
        }
        for pr in requests
    ]
    return Response(data)


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
