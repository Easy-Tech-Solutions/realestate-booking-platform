import logging
from datetime import timedelta, date as _date, time as _time

from django.db import transaction
from django.db.models import Avg as _Avg, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from listings.models import HotelRoom, Listing
from listings.serializers import ListingSerializer
from realestate_backend.app_logging import log_activity, log_transaction
from .models import (
    Booking, PaymentRequest, SavedSearch, SearchAlert, PropertyComparison,
    ComparisonItem, ViewingAppointment, HOST_CONFIRM_DAYS, PAYMENT_WINDOW_DAYS,
)
from .serializers import (
    BookingSerializer, BookingConfrimationSerializer, BookingCreateSerializer,
    SearchAlertSerializer, SavedSearchSerializer, SavedSearchCreateSerializer,
    PropertyComparisonSerializer, ComparisonCreateSerializer, ComparisonItemSerializer
)

logger = logging.getLogger(__name__)


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
        # Revised booking flow: a reservation is FREE. No payment is taken here.
        # The guest pays only after the host confirms (see confirm_booking →
        # awaiting_payment). Short-stay always requires host confirmation too —
        # there is no instant auto-confirm anymore.
        try:
            serializer = BookingCreateSerializer(data=request.data)
            if not serializer.is_valid():
                return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                # Lock the listing row so concurrent reservation requests queue
                # up rather than racing through the availability check.
                listing = Listing.objects.select_for_update().get(
                    pk=request.data.get('listing')
                )

                # A host can't reserve their own listing.
                if listing.owner_id == request.user.id:
                    return Response(
                        {'error': 'You cannot book your own listing.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                start      = serializer.validated_data['start_date']
                end        = serializer.validated_data['end_date']
                hotel_room = serializer.validated_data.get('hotel_room')
                # These are irrelevant at (free) reservation time — drop them so
                # they're not persisted onto the booking.
                serializer.validated_data.pop('payment_method', None)
                serializer.validated_data.pop('stripe_payment_intent_id', None)

                # A guest can't hold two active reservations for the same dates.
                existing_booking = Booking.objects.filter(
                    customer=request.user,
                    listing=listing,
                    start_date=start,
                    end_date=end,
                    status__in=Booking.ACTIVE_STATUSES,
                ).first()
                if existing_booking:
                    return Response({
                        'error': 'You already have an active reservation for this property on these dates',
                        'existing_booking_id': existing_booking.id,
                    }, status=status.HTTP_400_BAD_REQUEST)

                if hotel_room:
                    if hotel_room.listing_id != listing.id:
                        return Response({'error': 'Room does not belong to this listing'}, status=status.HTTP_400_BAD_REQUEST)
                    from listings.views import _get_available_room_count
                    if _get_available_room_count(hotel_room, start, end) < 1:
                        return Response({'error': 'Room not available for selected dates'}, status=status.HTTP_400_BAD_REQUEST)
                else:
                    # Reject only if a CONFIRMED booking already overlaps. Multiple
                    # *pending* reservations on the same dates are allowed — the
                    # host picks the winner (the others are auto-declined then).
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

                # Lock in the amounts the guest will pay once the host confirms,
                # so the figure matches what they saw at reservation time.
                from listings.views import compute_listing_pricing
                pricing = compute_listing_pricing(listing, start, end, room=hotel_room)
                total_price = round(pricing["total"], 2)
                service_fee = round(pricing["service_fee"], 2)

                booking = serializer.save(
                    customer=request.user,
                    status='pending_host',
                    total_price=total_price,
                    service_fee=service_fee,
                    host_confirm_deadline=timezone.now() + timedelta(days=HOST_CONFIRM_DAYS),
                )

            # Notify the host (to confirm) and admins — outside the lock.
            try:
                from notifications.services import notify_reservation_requested
                notify_reservation_requested(booking)
            except Exception:
                pass

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


@api_view(["GET", "DELETE"])
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

    elif request.method == "DELETE":
        # Soft cancel: keep the row for history / audit / dispute records instead
        # of hard-deleting. The partial unique constraint excludes 'cancelled',
        # so the guest can still re-book the same property/dates afterwards.
        if booking.status == 'cancelled':
            # Idempotent — already cancelled.
            return Response(BookingSerializer(booking, context={'request': request}).data)
        if booking.status in ('declined', 'completed'):
            return Response(
                {"error": f"A {booking.get_status_display().lower()} booking cannot be cancelled."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        was_holding = booking.status in ('awaiting_payment', 'payment_received', 'confirmed')
        booking.status = 'cancelled'
        booking.cancelled_at = timezone.now()
        booking.save(update_fields=['status', 'cancelled_at'])

        # If this booking had the listing pulled from public view, put it back
        # (unless another booking now holds it).
        if was_holding:
            from .services import release_listing_if_unheld
            release_listing_if_unheld(booking.listing, exclude_booking=booking)

        return Response(BookingSerializer(booking, context={'request': request}).data, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def pending_bookings(request):
    if request.user.role not in ['agent', 'admin']:
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    bookings = Booking.objects.filter(
        listing__owner=request.user,
        status__in=['pending_host', 'requested', 'pending'],  # legacy statuses included
    ).order_by('-requested_at')
    return Response(BookingSerializer(bookings, many=True, context={'request': request}).data)


# Statuses a host can act on when confirming/declining a reservation
# ('requested'/'pending' are legacy rows from before the flow change).
_HOST_ACTIONABLE = ('pending_host', 'requested', 'pending')


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def confirm_booking(request, id):
    """
    Host confirms a reservation. This does NOT finalize the booking — it moves
    it to 'awaiting_payment', pulls the listing from public view, starts the
    10-day payment clock, and auto-declines competing reservations. The guest
    then pays, and an admin confirms the payment (see admin_confirm_payment).
    """
    try:
        booking = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    if booking.listing.owner != request.user:
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    if booking.status not in _HOST_ACTIONABLE:
        return Response({'error': 'Booking cannot be confirmed'}, status=status.HTTP_400_BAD_REQUEST)

    from .services import host_confirm_reservation
    host_confirm_reservation(booking)

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

    if booking.status not in _HOST_ACTIONABLE:
        return Response({"error": "Booking cannot be declined"}, status=status.HTTP_400_BAD_REQUEST)

    serializer = BookingConfrimationSerializer(data=request.data)
    if serializer.is_valid():
        from .services import process_booking_decline
        process_booking_decline(
            booking,
            decline_reason=serializer.validated_data.get('decline_reason', ''),
            owner_notes=serializer.validated_data.get('owner_notes', ''),
        )
        log_activity(
            request, 'booking_declined',
            resource_type='booking', resource_id=booking.id,
            listing_id=booking.listing_id, customer_id=booking.customer_id,
            reason=serializer.validated_data.get('decline_reason', ''),
        )
        return Response(BookingSerializer(booking, context={'request': request}).data)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def admin_confirm_payment(request, id):
    """
    Admin confirms a received payment. All guest payments land in Home Konet's
    account, so an admin verifies each one — this finalizes the booking
    ('confirmed'), shares host contact, and creates the host Payout record.
    """
    if request.user.role != 'admin' and not request.user.is_superuser:
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        booking = Booking.objects.get(pk=id)
    except Booking.DoesNotExist:
        return Response({'error': 'Booking not found'}, status=status.HTTP_404_NOT_FOUND)

    if booking.status != 'payment_received':
        return Response(
            {'error': f'Only a booking with a received payment can be confirmed (current: {booking.status}).'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from .services import admin_confirm_payment as _confirm
    _confirm(booking, admin_user=request.user)
    return Response(BookingSerializer(booking, context={'request': request}).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def admin_payment_received_bookings(request):
    """Admin: bookings whose payment is awaiting confirmation."""
    if request.user.role != 'admin' and not request.user.is_superuser:
        return Response({'error': 'Permission Denied'}, status=status.HTTP_403_FORBIDDEN)
    bookings = Booking.objects.filter(status='payment_received').select_related(
        'listing', 'customer'
    ).order_by('requested_at')
    return Response(BookingSerializer(bookings, many=True, context={'request': request}).data)


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
        booking__customer=request.user,
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


# ===== Viewing appointments (Path C — long-term verification) ================

_SATURDAY = 5  # Python date.weekday(): Monday=0 ... Saturday=5


def _next_saturdays(after_date, count, exclude=None):
    """Return the next `count` Saturdays strictly after `after_date`,
    skipping any dates in `exclude`."""
    exclude = exclude or set()
    days_ahead = (_SATURDAY - after_date.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7  # never offer "today" — start from the next Saturday
    sat = after_date + timedelta(days=days_ahead)
    out = []
    while len(out) < count:
        if sat not in exclude:
            out.append(sat)
        sat += timedelta(days=7)
    return out


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def viewing_slots(request, listing_id):
    """Return the next available Saturday viewing slots for a listing.

    One slot per property per Saturday: any Saturday already held by an active
    viewing for this listing is skipped, so the next free Saturday is offered.
    """
    listing = get_object_or_404(Listing, pk=listing_id)
    taken = set(
        ViewingAppointment.objects.filter(
            listing=listing,
            status__in=ViewingAppointment.ACTIVE_STATUSES,
        ).values_list('viewing_date', flat=True)
    )
    slots = _next_saturdays(timezone.now().date(), 8, exclude=taken)
    return Response({
        'listing': listing.id,
        'available_saturdays': [s.isoformat() for s in slots],
    })


@api_view(['GET', 'POST'])
@permission_classes([IsAuthenticated])
def viewings_collection(request):
    """GET: the requester's viewing appointments. POST: request a new viewing."""
    from .serializers import ViewingAppointmentSerializer

    if request.method == 'GET':
        viewings = ViewingAppointment.objects.filter(
            guest=request.user
        ).select_related('listing').order_by('-created_at')
        return Response(ViewingAppointmentSerializer(viewings, many=True, context={'request': request}).data)

    # POST — request a viewing on a chosen Saturday.
    listing_id = request.data.get('listing')
    date_str = request.data.get('viewing_date')
    if not listing_id or not date_str:
        return Response({'error': 'listing and viewing_date are required'}, status=status.HTTP_400_BAD_REQUEST)

    listing = get_object_or_404(Listing, pk=listing_id)

    # A host can't request a viewing of their own listing.
    if listing.owner_id == request.user.id:
        return Response({'error': 'You cannot request a viewing of your own listing.'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        viewing_date = _date.fromisoformat(date_str)
    except ValueError:
        return Response({'error': 'Invalid viewing_date. Use YYYY-MM-DD'}, status=status.HTTP_400_BAD_REQUEST)

    if viewing_date.weekday() != _SATURDAY:
        return Response({'error': 'Viewings are only available on Saturdays'}, status=status.HTTP_400_BAD_REQUEST)
    if viewing_date <= timezone.now().date():
        return Response({'error': 'Viewing date must be in the future'}, status=status.HTTP_400_BAD_REQUEST)

    # Guest must pick one of the six 2-hour start blocks (10:00–15:00).
    time_str = (request.data.get('viewing_time') or '').strip()
    # Normalize 'HH:MM:SS' → 'HH:MM'.
    time_str = time_str[:5]
    if time_str not in ViewingAppointment.START_TIMES:
        return Response(
            {'error': 'Please choose a viewing time between 10:00 AM and 3:00 PM.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    viewing_time = _time.fromisoformat(time_str)

    from payments.models import get_viewing_fee
    try:
        with transaction.atomic():
            # Honor the one-slot-per-Saturday rule even under concurrency.
            slot_taken = ViewingAppointment.objects.select_for_update().filter(
                listing=listing,
                viewing_date=viewing_date,
                status__in=ViewingAppointment.ACTIVE_STATUSES,
            ).exists()
            if slot_taken:
                return Response(
                    {'error': 'That Saturday is already booked for this property. Please choose another.'},
                    status=status.HTTP_409_CONFLICT,
                )
            viewing = ViewingAppointment.objects.create(
                listing=listing,
                guest=request.user,
                viewing_date=viewing_date,
                viewing_time=viewing_time,
                viewing_fee=get_viewing_fee(),
                guest_notes=request.data.get('guest_notes', ''),
            )
    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    try:
        from notifications.services import notify_viewing_requested
        notify_viewing_requested(viewing)
    except Exception:
        pass

    from .serializers import ViewingAppointmentSerializer
    return Response(ViewingAppointmentSerializer(viewing, context={'request': request}).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reserve_from_viewing(request, viewing_id):
    """Guest clicks "Reserve Property" after a completed viewing (Path C).

    Creates a reservation already in 'awaiting_payment' with the 10-day clock
    running, and pulls the listing from public view.
    """
    try:
        viewing = ViewingAppointment.objects.select_related('listing').get(pk=viewing_id, guest=request.user)
    except ViewingAppointment.DoesNotExist:
        return Response({'error': 'Viewing not found'}, status=status.HTTP_404_NOT_FOUND)

    if viewing.listing.owner_id == request.user.id:
        return Response({'error': 'You cannot reserve your own listing.'}, status=status.HTTP_400_BAD_REQUEST)

    if viewing.status != 'completed':
        return Response(
            {'error': 'You can only reserve after the viewing has been completed.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if viewing.booking_id:
        return Response({'error': 'You have already reserved this property.'}, status=status.HTTP_400_BAD_REQUEST)

    start_str = request.data.get('start_date')
    end_str = request.data.get('end_date')
    if not start_str or not end_str:
        return Response({'error': 'start_date and end_date are required'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        start = _date.fromisoformat(start_str)
        end = _date.fromisoformat(end_str)
    except ValueError:
        return Response({'error': 'Invalid date format. Use YYYY-MM-DD'}, status=status.HTTP_400_BAD_REQUEST)
    if start >= end:
        return Response({'error': 'End date must be after start date'}, status=status.HTTP_400_BAD_REQUEST)

    # A guest can only hold one active booking per listing+dates (enforced by a
    # partial unique index). Surface that as a clean 400 rather than a 500.
    if Booking.objects.filter(
        customer=request.user, listing=viewing.listing,
        start_date=start, end_date=end,
        status__in=['pending_host', 'awaiting_payment', 'payment_received', 'confirmed'],
    ).exists():
        return Response(
            {'error': 'You already have an active booking for these dates.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from listings.views import compute_listing_pricing
    pricing = compute_listing_pricing(viewing.listing, start, end)
    total_price = round(pricing['total'], 2)
    service_fee = round(pricing['service_fee'], 2)

    from .services import reserve_property_from_viewing
    booking = reserve_property_from_viewing(viewing, start, end, total_price, service_fee)
    return Response(BookingSerializer(booking, context={'request': request}).data, status=status.HTTP_201_CREATED)


# ===== Payouts ===============================================================

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def my_payouts(request):
    """Return the authenticated host's payout records."""
    from payments.models import Payout
    payouts = Payout.objects.filter(host=request.user).select_related('booking', 'booking__listing')
    data = [
        {
            'id': str(p.id),
            'booking_id': p.booking_id,
            'listing_title': p.booking.listing.title,
            'gross_amount': str(p.gross_amount),
            'service_fee_amount': str(p.service_fee_amount),
            'net_amount': str(p.net_amount),
            'currency': p.currency,
            'status': p.status,
            'paid_at': p.paid_at.isoformat() if p.paid_at else None,
            'created_at': p.created_at.isoformat(),
        }
        for p in payouts
    ]
    return Response(data)
