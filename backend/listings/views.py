from rest_framework.decorators import api_view, parser_classes
from django.db import models
from django.db.models import Avg, Count, Sum, Q
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from rest_framework import status
from django.utils import timezone
from datetime import timedelta
from rest_framework.parsers import MultiPartParser, FormParser
from django.db import IntegrityError
import math
from .models import Listing, ListingImage, Favorite, Review, ReviewImage, PropertyView, PropertyStats, PropertyCategory, HotelRoom, HotelRoomImage
from bookings.models import Booking
from .serializers import ListingSerializer, ListingImageCreateSerializer, FavoriteSerializer, ReviewSerializer, ReviewCreateSerializer, PropertyCategorySerializer, HotelRoomSerializer, HotelRoomImageSerializer
from .filters import ListingFilter
from django.contrib.auth import get_user_model
from rest_framework.pagination import PageNumberPagination

User = get_user_model()


class _ListingPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


def _is_admin(user):
    return bool(user and user.is_authenticated and (getattr(user, 'role', None) == 'admin' or user.is_superuser))


@api_view(["GET", "POST"])
def categories_collection(request):
    if request.method == "GET":
        queryset = PropertyCategory.objects.all().order_by('sort_order', 'name')
        if not _is_admin(request.user):
            queryset = queryset.filter(is_active=True)
        return Response(PropertyCategorySerializer(queryset, many=True).data)

    if not _is_admin(request.user):
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    serializer = PropertyCategorySerializer(data=request.data)
    if serializer.is_valid():
        category = serializer.save()
        return Response(PropertyCategorySerializer(category).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["PUT", "DELETE"])
def category_detail(request, id):
    if not _is_admin(request.user):
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    category = get_object_or_404(PropertyCategory, pk=id)

    if request.method == "PUT":
        serializer = PropertyCategorySerializer(category, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    category.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser])
def listings_collection(request):
    if request.method == "GET":
        items = ListingFilter(
            request.GET,
            queryset=Listing.objects.filter(status='published', deleted_at__isnull=True),
        )
        qs = items.qs

        # When the search includes check-in/check-out, hide listings that
        # already have a confirmed booking overlapping those dates. A booking
        # overlaps if it starts before our check-out and ends after our
        # check-in (standard half-open interval test).
        check_in = request.GET.get('check_in')
        check_out = request.GET.get('check_out')
        if check_in and check_out:
            from bookings.models import Booking
            conflicting_listing_ids = Booking.objects.filter(
                status='confirmed',
                start_date__lt=check_out,
                end_date__gt=check_in,
            ).values_list('listing_id', flat=True)
            qs = qs.exclude(id__in=conflicting_listing_ids)

        paginator = _ListingPagination()
        page = paginator.paginate_queryset(qs, request)
        serialized = ListingSerializer(page, many=True, context={"request": request}).data
        return paginator.get_paginated_response(serialized)

    elif request.method == "POST":
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        serializer = ListingSerializer(data=request.data)
        if serializer.is_valid():
            listing = serializer.save(owner=request.user)
            return Response(ListingSerializer(listing, context={"request": request}).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "PUT", "DELETE"])
def listing_detail(request, id):
    try:
        item = Listing.objects.get(pk=id)
    except Listing.DoesNotExist:
        return Response({"error": "Listing not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        # Soft-deleted listings 404 for everyone except the owner / admin so
        # that direct-URL access doesn't bypass the search-page filter.
        if item.deleted_at is not None and not (
            request.user.is_authenticated and (item.owner == request.user or request.user.is_superuser)
        ):
            return Response({"error": "Listing not found"}, status=status.HTTP_404_NOT_FOUND)
        return Response(ListingSerializer(item, context={"request": request}).data)

    elif request.method == "PUT":
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        if item.owner != request.user and not request.user.is_superuser:
            return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
        serializer = ListingSerializer(item, data=request.data, partial=True, context={"request": request})
        if serializer.is_valid():
            serializer.save()
            return Response(ListingSerializer(item, context={"request": request}).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == "DELETE":
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        if item.owner != request.user and not request.user.is_superuser:
            return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
        from .deletion import delete_listing
        ok, error = delete_listing(item)
        if not ok:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "POST"])
def listing_images(request, listing_id):
    try:
        listing = Listing.objects.get(pk=listing_id)
    except Listing.DoesNotExist:
        return Response({"error": "Listing not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        images = listing.gallery_images.all()
        return Response(ListingImageCreateSerializer(images, many=True).data)

    elif request.method == "POST":
        if not request.user.is_authenticated:
            return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
        if listing.owner != request.user:
            return Response({"error": "Only the owner can add images"}, status=status.HTTP_403_FORBIDDEN)
        serializer = ListingImageCreateSerializer(data=request.data)
        if serializer.is_valid():
            if serializer.validated_data.get("order") is None:
                max_order = listing.gallery_images.aggregate(models.Max("order"))["order__max"] or 0
                serializer.validated_data["order"] = max_order + 1
            try:
                image = serializer.save(listing=listing)
            except IntegrityError:
                return Response({"error": "An image with this display order already exists for the listing."}, status=status.HTTP_400_BAD_REQUEST)
            return Response(ListingImageCreateSerializer(image).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["DELETE"])
def listing_image_detail(request, listing_id, image_id):
    try:
        listing = Listing.objects.get(pk=listing_id)
        image = listing.gallery_images.get(pk=image_id)
    except (Listing.DoesNotExist, ListingImage.DoesNotExist):
        return Response({"error": "Not Found"}, status=status.HTTP_404_NOT_FOUND)

    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    if listing.owner != request.user:
        return Response({"error": "Only the owner can delete images"}, status=status.HTTP_403_FORBIDDEN)

    image.delete()
    return Response({"message": "Image deleted"}, status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def favorites_collection(request):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    favorites = Favorite.objects.filter(user=request.user).select_related("listing", "user").order_by("-created_at")
    return Response(FavoriteSerializer(favorites, many=True, context={"request": request}).data)


@api_view(["POST", "DELETE"])
def favorite_listing(request, id):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    listing = get_object_or_404(Listing, pk=id)

    if request.method == "POST":
        favorite, created = Favorite.objects.get_or_create(user=request.user, listing=listing)
        return Response(
            FavoriteSerializer(favorite, context={"request": request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    if request.method == "DELETE":
        Favorite.objects.filter(user=request.user, listing=listing).delete()
        return Response({"message": "Favorite listing deleted"}, status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def listing_reviews(request, listing_id):
    listing = get_object_or_404(Listing, pk=listing_id)
    reviews = Review.objects.filter(listing=listing).select_related('reviewer', 'reviewer__profile')
    return Response(ReviewSerializer(reviews, many=True, context={"request": request}).data)


@api_view(["GET"])
def all_reviews(request):
    """
    GET /api/listings/reviews/  — public paginated list of all reviews.
    Query params: ?ordering=-created_at|rating  ?min_rating=4  ?page=1
    """
    qs = Review.objects.select_related(
        'reviewer', 'reviewer__profile', 'listing'
    ).prefetch_related('images')

    min_rating = request.query_params.get('min_rating')
    if min_rating:
        try:
            qs = qs.filter(rating__gte=int(min_rating))
        except ValueError:
            pass

    listing_id_param = request.query_params.get('listing_id')
    if listing_id_param:
        qs = qs.filter(listing_id=listing_id_param)

    ordering = request.query_params.get('ordering', '-created_at')
    if ordering in ('created_at', '-created_at', 'rating', '-rating'):
        qs = qs.order_by(ordering)

    paginator = _ListingPagination()
    paginator.page_size = 12
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(
        ReviewSerializer(page, many=True, context={'request': request}).data
    )


@api_view(["POST"])
def create_review(request):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    listing = get_object_or_404(Listing, pk=request.data.get("listing"))

    # A stay counts as "complete" if either:
    #   - the booking has explicit status='completed', or
    #   - it's still 'confirmed' but the checkout date has passed (nothing
    #     in the system auto-flips the status today, so without this branch
    #     past stays could never leave a review).
    today = timezone.now().date()
    has_completed_stay = Booking.objects.filter(
        listing=listing,
        customer=request.user,
    ).filter(
        Q(status='completed') | Q(status='confirmed', end_date__lt=today)
    ).exists()

    if not has_completed_stay:
        return Response({"error": "You must complete a stay before leaving a review"}, status=status.HTTP_400_BAD_REQUEST)

    if Review.objects.filter(listing=listing, reviewer=request.user).exists():
        return Response({"error": "You have already reviewed this listing"}, status=status.HTTP_400_BAD_REQUEST)

    serializer = ReviewCreateSerializer(data=request.data)
    if serializer.is_valid():
        review = serializer.save(reviewer=request.user)
        return Response(ReviewSerializer(review, context={"request": request}).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "PUT", "DELETE"])
def review_detail(request, id):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    review = get_object_or_404(Review, pk=id)

    if request.method == "GET":
        return Response(ReviewSerializer(review, context={"request": request}).data)

    if review.reviewer != request.user and not request.user.is_superuser:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "PUT":
        serializer = ReviewSerializer(review, data=request.data, partial=True, context={"request": request})
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    if request.method == "DELETE":
        review.delete()
        return Response({"message": "Review deleted"}, status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def user_reviews(request, user_id):
    user = get_object_or_404(User, pk=user_id)
    reviews = Review.objects.filter(reviewer=user)
    return Response(ReviewSerializer(reviews, many=True, context={"request": request}).data)


@api_view(["GET"])
def listing_stats(request, listing_id):
    listing = get_object_or_404(Listing, pk=listing_id)

    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    if listing.owner != request.user and not request.user.is_superuser:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    try:
        days = min(int(request.GET.get("days", 30)), 365)
    except (ValueError, TypeError):
        return Response({"error": "days must be a valid integer"}, status=status.HTTP_400_BAD_REQUEST)
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    total_views = PropertyView.objects.filter(listing=listing).count()
    unique_views = PropertyView.objects.filter(listing=listing).values("ip_address").distinct().count()
    total_favorites = Favorite.objects.filter(listing=listing).count()
    total_bookings = Booking.objects.filter(listing=listing).count()
    total_revenue = Booking.objects.filter(listing=listing, status="confirmed").aggregate(
        total=Sum("total_price"))["total"] or 0

    daily_stats = PropertyStats.objects.filter(listing=listing, date__gte=start_date, date__lte=end_date).order_by("date")

    view_to_favorite_rate = (total_favorites / total_views * 100) if total_views > 0 else 0
    view_to_booking_rate = (total_bookings / total_views * 100) if total_views > 0 else 0

    return Response({
        "listing": {"id": listing.id, "title": listing.title, "price": str(listing.price)},
        "summary": {
            "total_views": total_views,
            "unique_views": unique_views,
            "total_favorites": total_favorites,
            "total_bookings": total_bookings,
            "total_revenue": str(total_revenue),
            "view_to_favorite_rate": round(view_to_favorite_rate, 2),
            "view_to_booking_rate": round(view_to_booking_rate, 2),
        },
        "daily_stats": [
            {
                "date": stat.date.isoformat(),
                "views": stat.views,
                "unique_views": stat.unique_views,
                "favorites": stat.favorites,
                "bookings": stat.bookings,
                "revenue": str(stat.revenue),
            }
            for stat in daily_stats
        ],
        "period": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "days": days},
    })


@api_view(["GET"])
def agent_analytics(request):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    user = request.user
    if user.role not in ["agent", "admin"]:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    try:
        days = min(int(request.GET.get("days", 30)), 365)
    except (ValueError, TypeError):
        return Response({"error": "days must be a valid integer"}, status=status.HTTP_400_BAD_REQUEST)
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    listings = Listing.objects.filter(owner=user).annotate(
        view_count=Count('property_views', distinct=True),
        favorite_count=Count('favorited_by', distinct=True),
        booking_count=Count('bookings', distinct=True),
        confirmed_revenue=Sum('bookings__total_price', filter=Q(bookings__status='confirmed')),
    )
    total_listings = listings.count()
    total_views = sum(l.view_count for l in listings)
    total_favorites = sum(l.favorite_count for l in listings)
    total_bookings = sum(l.booking_count for l in listings)
    total_revenue = sum(l.confirmed_revenue or 0 for l in listings)

    property_stats = [
        {
            "id": l.id,
            "title": l.title,
            "price": str(l.price),
            "views": l.view_count,
            "favorites": l.favorite_count,
            "bookings": l.booking_count,
            "revenue": str(l.confirmed_revenue or 0),
        }
        for l in listings
    ]

    property_stats.sort(key=lambda x: float(x["revenue"]), reverse=True)

    return Response({
        "agent": {"id": user.id, "username": user.username, "role": user.role},
        "summary": {
            "total_listings": total_listings,
            "total_views": total_views,
            "total_favorites": total_favorites,
            "total_bookings": total_bookings,
            "total_revenue": str(total_revenue),
        },
        "property_performance": property_stats,
        "period": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat(), "days": days},
    })


@api_view(["GET"])
def popular_listings(request):
    days = int(request.GET.get("days", 7))
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    view_counts = (
        PropertyView.objects
        .filter(timestamp__date__gte=start_date, timestamp__date__lte=end_date)
        .values("listing")
        .annotate(view_count=Count("id"))
        .order_by("-view_count")[:20]
    )

    listing_ids = [item["listing"] for item in view_counts]
    listings_map = {
        l.id: l
        for l in Listing.objects.filter(pk__in=listing_ids)
        .select_related('owner')
        .annotate(favorite_count=Count('favorited_by', distinct=True))
    }

    result = []
    for item in view_counts:
        listing = listings_map.get(item["listing"])
        if not listing:
            continue
        result.append({
            "id": listing.id,
            "title": listing.title,
            "price": str(listing.price),
            "property_type": listing.property_type,
            "address": listing.address,
            "main_image_url": request.build_absolute_uri(listing.main_image.url) if listing.main_image else None,
            "owner_username": listing.owner.username,
            "views": item["view_count"],
            "favorites": listing.favorite_count,
        })

    return Response({"popular_listings": result})


@api_view(["GET"])
def platform_stats(request):
    """Public endpoint returning site-wide stats for the landing page."""
    total_properties = Listing.objects.filter(is_available=True).count()
    total_locations = (
        Listing.objects.filter(is_available=True, address__isnull=False)
        .exclude(address="")
        .values("address")
        .distinct()
        .count()
    )
    happy_guests = Review.objects.values("reviewer").distinct().count()
    return Response({
        "total_properties": total_properties,
        "total_locations": total_locations,
        "happy_guests": happy_guests,
    })


def _haversine(lat1, lon1, lat2, lon2):
    """Return distance in km between two (lat, lng) points."""
    R = 6371.0
    lat1, lon1, lat2, lon2 = (math.radians(float(v)) for v in (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


@api_view(["GET"])
def nearby_listings(request):
    """
    GET /api/listings/nearby/?lat=X&lng=Y&radius=50
    Returns published listings within `radius` km (default 50, max 200), sorted by distance.
    """
    try:
        user_lat = float(request.query_params["lat"])
        user_lng = float(request.query_params["lng"])
    except (KeyError, ValueError):
        return Response({"error": "lat and lng query params are required."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        radius_km = min(float(request.query_params.get("radius", 50)), 200)
    except ValueError:
        radius_km = 50

    qs = (
        Listing.objects
        .filter(status="published", latitude__isnull=False, longitude__isnull=False)
        .exclude(latitude=0, longitude=0)
        .select_related("owner")
    )

    nearby = []
    for listing in qs:
        dist = _haversine(user_lat, user_lng, listing.latitude, listing.longitude)
        if dist <= radius_km:
            nearby.append((dist, listing))

    nearby.sort(key=lambda x: x[0])
    nearby = nearby[:12]

    results = []
    for dist, listing in nearby:
        data = ListingSerializer(listing, context={"request": request}).data
        data["distance_km"] = round(dist, 1)
        results.append(data)

    return Response(results)


@api_view(["GET"])
def listing_availability(request, listing_id):
    from datetime import timedelta as _td
    listing = get_object_or_404(Listing, pk=listing_id)
    bookings = Booking.objects.filter(
        listing=listing,
        status__in=["requested", "confirmed"],
    ).values("start_date", "end_date")

    booked_dates = []
    for b in bookings:
        current = b["start_date"]
        while current < b["end_date"]:
            booked_dates.append(current.isoformat())
            current += _td(days=1)

    return Response({"booked_dates": booked_dates})


def compute_listing_pricing(listing, start, end, room=None):
    """Compute the full pricing breakdown for a stay. Shared by the pricing
    endpoint and booking creation so the email/receipt total matches what the
    guest saw at checkout."""
    from datetime import date as _date, timedelta as _td

    nights = (end - start).days
    base_price = float(room.price_per_night) if room else float(listing.price)
    weekend_premium = listing.weekend_premium_percent / 100.0

    subtotal = 0.0
    for i in range(nights):
        day = start + _td(days=i)
        is_weekend = day.weekday() >= 4
        night_price = base_price * (1 + weekend_premium) if is_weekend else base_price
        subtotal += night_price

    discount = 0.0
    discount_label = None
    if nights >= 28 and listing.monthly_discount_enabled:
        discount = subtotal * listing.monthly_discount_percent / 100
        discount_label = f"{listing.monthly_discount_percent}% monthly discount"
    elif nights >= 7 and listing.weekly_discount_enabled:
        discount = subtotal * listing.weekly_discount_percent / 100
        discount_label = f"{listing.weekly_discount_percent}% weekly discount"
    elif listing.last_minute_discount_enabled:
        days_until = (start - _date.today()).days
        if days_until <= 3:
            discount = subtotal * listing.last_minute_discount_percent / 100
            discount_label = f"{listing.last_minute_discount_percent}% last-minute discount"

    discounted_subtotal = subtotal - discount
    # Cleaning fee and taxes are disabled for now — the guest is only charged
    # the nightly subtotal plus the platform service fee. Kept as 0.0 in the
    # response so any consumer that still reads these keys keeps working.
    cleaning_fee = 0.0
    service_fee = discounted_subtotal * 0.04
    taxes = 0.0
    total = discounted_subtotal + service_fee

    return {
        "nights": nights,
        "base_price": base_price,
        "subtotal": subtotal,
        "discount": discount,
        "discount_label": discount_label,
        "discounted_subtotal": discounted_subtotal,
        "cleaning_fee": cleaning_fee,
        "service_fee": service_fee,
        "taxes": taxes,
        "total": total,
    }


@api_view(["GET"])
def listing_pricing(request, listing_id):
    from datetime import date as _date

    listing = get_object_or_404(Listing, pk=listing_id)
    start_str = request.GET.get("start_date")
    end_str = request.GET.get("end_date")

    if not start_str or not end_str:
        return Response({"error": "start_date and end_date are required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        start = _date.fromisoformat(start_str)
        end = _date.fromisoformat(end_str)
    except ValueError:
        return Response({"error": "Invalid date format. Use YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)

    if end <= start:
        return Response({"error": "end_date must be after start_date"}, status=status.HTTP_400_BAD_REQUEST)

    room = None
    room_id = request.GET.get("room_id")
    if room_id:
        try:
            room = HotelRoom.objects.get(pk=room_id, listing=listing, is_active=True)
        except HotelRoom.DoesNotExist:
            pass

    pricing = compute_listing_pricing(listing, start, end, room=room)
    nights = pricing["nights"]
    base_price = pricing["base_price"]
    subtotal = pricing["subtotal"]
    discount = pricing["discount"]
    discount_label = pricing["discount_label"]
    discounted_subtotal = pricing["discounted_subtotal"]
    cleaning_fee = pricing["cleaning_fee"]
    service_fee = pricing["service_fee"]
    taxes = pricing["taxes"]
    total = pricing["total"]

    return Response({
        "nights": nights,
        "base_price": base_price,
        "subtotal": round(subtotal, 2),
        "discount": round(discount, 2),
        "discount_label": discount_label,
        "discounted_subtotal": round(discounted_subtotal, 2),
        "cleaning_fee": round(cleaning_fee, 2),
        "service_fee": round(service_fee, 2),
        "taxes": round(taxes, 2),
        "total": round(total, 2),
    })


@api_view(["POST"])
def review_response(request, id):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    review = get_object_or_404(Review, pk=id)

    if review.listing.owner != request.user:
        return Response({"error": "Only the listing owner can respond to reviews"}, status=status.HTTP_403_FORBIDDEN)

    response_text = request.data.get("response", "").strip()
    if not response_text:
        return Response({"error": "Response text is required"}, status=status.HTTP_400_BAD_REQUEST)

    review.host_response = response_text
    review.host_response_at = timezone.now()
    review.save()

    return Response(ReviewSerializer(review, context={"request": request}).data)


def _get_available_room_count(room, start_date, end_date):
    overlapping = Booking.objects.filter(
        hotel_room=room,
        status__in=['requested', 'confirmed'],
        start_date__lt=end_date,
        end_date__gt=start_date,
    ).count()
    return max(0, room.total_count - overlapping)


@api_view(["GET", "POST"])
def hotel_rooms_collection(request, listing_id):
    listing = get_object_or_404(Listing, pk=listing_id)

    if request.method == "GET":
        is_owner = request.user.is_authenticated and (
            listing.owner == request.user or request.user.is_superuser
        )
        rooms = listing.hotel_rooms.all() if is_owner else listing.hotel_rooms.filter(is_active=True)
        return Response(HotelRoomSerializer(rooms, many=True).data)

    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    if listing.owner != request.user and not request.user.is_superuser:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    serializer = HotelRoomSerializer(data={**request.data, 'listing': listing.id})
    if serializer.is_valid():
        room = serializer.save(listing=listing)
        return Response(HotelRoomSerializer(room).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["GET", "PUT", "DELETE"])
def hotel_room_detail(request, listing_id, room_id):
    listing = get_object_or_404(Listing, pk=listing_id)
    room = get_object_or_404(HotelRoom, pk=room_id, listing=listing)

    if request.method == "GET":
        return Response(HotelRoomSerializer(room).data)

    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    if listing.owner != request.user and not request.user.is_superuser:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "PUT":
        serializer = HotelRoomSerializer(room, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(HotelRoomSerializer(room).data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    room.delete()
    return Response({"message": "Room deleted"}, status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def hotel_room_availability(request, listing_id):
    from datetime import date as _date

    listing = get_object_or_404(Listing, pk=listing_id)
    start_str = request.GET.get("start_date")
    end_str = request.GET.get("end_date")

    if not start_str or not end_str:
        return Response({"error": "start_date and end_date are required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        start = _date.fromisoformat(start_str)
        end = _date.fromisoformat(end_str)
    except ValueError:
        return Response({"error": "Invalid date format. Use YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)

    rooms = listing.hotel_rooms.filter(is_active=True)
    result = []
    for room in rooms:
        available_count = _get_available_room_count(room, start, end)
        data = HotelRoomSerializer(room).data
        data['available_count'] = available_count
        result.append(data)

    return Response(result)


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser])
def hotel_room_images(request, listing_id, room_id):
    listing = get_object_or_404(Listing, pk=listing_id)
    room = get_object_or_404(HotelRoom, pk=room_id, listing=listing)

    if request.method == "GET":
        return Response(HotelRoomImageSerializer(room.images.all(), many=True).data)

    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    if listing.owner != request.user and not request.user.is_superuser:
        return Response({"error": "Only the owner can add room images"}, status=status.HTTP_403_FORBIDDEN)

    serializer = HotelRoomImageSerializer(data=request.data)
    if serializer.is_valid():
        max_order = room.images.aggregate(models.Max("order"))["order__max"]
        order = (max_order or 0) + 1
        image = serializer.save(room=room, order=order)
        return Response(HotelRoomImageSerializer(image).data, status=status.HTTP_201_CREATED)
    return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


@api_view(["DELETE"])
def hotel_room_image_detail(request, listing_id, room_id, image_id):
    listing = get_object_or_404(Listing, pk=listing_id)
    room = get_object_or_404(HotelRoom, pk=room_id, listing=listing)
    image = get_object_or_404(HotelRoomImage, pk=image_id, room=room)

    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    if listing.owner != request.user and not request.user.is_superuser:
        return Response({"error": "Only the owner can delete room images"}, status=status.HTTP_403_FORBIDDEN)

    image.delete()
    return Response({"message": "Image deleted"}, status=status.HTTP_204_NO_CONTENT)


@api_view(["GET"])
def my_drafts(request):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    drafts = Listing.objects.filter(owner=request.user, status='draft').order_by('-updated_at')
    return Response(ListingSerializer(drafts, many=True, context={"request": request}).data)


@api_view(["GET"])
def my_listings(request):
    """Authenticated host: see all own listings (all statuses)."""
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)
    items = Listing.objects.filter(owner=request.user).exclude(status='draft').order_by('-created_at')
    return Response(ListingSerializer(items, many=True, context={"request": request}).data)


@api_view(["GET"])
def pending_review_listings(request):
    """Admin-only: listings waiting for review."""
    if not request.user.is_authenticated or not (request.user.is_staff or getattr(request.user, 'role', '') == 'admin'):
        return Response({"error": "Admin access required"}, status=status.HTTP_403_FORBIDDEN)
    items = Listing.objects.filter(status='pending_review').order_by('-created_at')
    return Response(ListingSerializer(items, many=True, context={"request": request}).data)


@api_view(["POST"])
def approve_listing(request, id):
    """Admin approves a pending listing — sets status to published."""
    if not request.user.is_authenticated or not (request.user.is_staff or getattr(request.user, 'role', '') == 'admin'):
        return Response({"error": "Admin access required"}, status=status.HTTP_403_FORBIDDEN)
    try:
        listing = Listing.objects.get(pk=id)
    except Listing.DoesNotExist:
        return Response({"error": "Listing not found"}, status=status.HTTP_404_NOT_FOUND)
    if listing.status not in ('pending_review', 'rejected'):
        return Response({"error": "Listing is not pending review"}, status=status.HTTP_400_BAD_REQUEST)
    listing.status = 'published'
    listing.save(update_fields=['status'])
    # Send email notification to host
    try:
        from django.core.mail import send_mail
        from django.conf import settings as django_settings
        send_mail(
            subject='Your listing has been approved — HomeKonet',
            message=f'Hi {listing.owner.first_name},\n\nGreat news! Your listing "{listing.title}" has been reviewed and approved. It is now live on HomeKonet.\n\nThank you for being part of our community!\n\nThe HomeKonet Team',
            from_email=getattr(django_settings, 'DEFAULT_FROM_EMAIL', 'noreply@homekonet.com'),
            recipient_list=[listing.owner.email],
            fail_silently=True,
        )
    except Exception:
        pass
    return Response(ListingSerializer(listing, context={"request": request}).data)


@api_view(["POST"])
def reject_listing(request, id):
    """Admin rejects a pending listing."""
    if not request.user.is_authenticated or not (request.user.is_staff or getattr(request.user, 'role', '') == 'admin'):
        return Response({"error": "Admin access required"}, status=status.HTTP_403_FORBIDDEN)
    try:
        listing = Listing.objects.get(pk=id)
    except Listing.DoesNotExist:
        return Response({"error": "Listing not found"}, status=status.HTTP_404_NOT_FOUND)
    listing.status = 'rejected'
    listing.save(update_fields=['status'])
    reason = request.data.get('reason', '')
    # Notify host
    try:
        from django.core.mail import send_mail
        from django.conf import settings as django_settings
        msg = f'Hi {listing.owner.first_name},\n\nUnfortunately, your listing "{listing.title}" was not approved at this time.'
        if reason:
            msg += f'\n\nReason: {reason}'
        msg += '\n\nYou may update your listing and resubmit, or contact us at homekonnet@gmail.com for help.\n\nThe HomeKonet Team'
        send_mail(
            subject='Update on your listing submission — HomeKonet',
            message=msg,
            from_email=getattr(django_settings, 'DEFAULT_FROM_EMAIL', 'noreply@homekonet.com'),
            recipient_list=[listing.owner.email],
            fail_silently=True,
        )
    except Exception:
        pass
    return Response({"status": "rejected", "reason": reason})
