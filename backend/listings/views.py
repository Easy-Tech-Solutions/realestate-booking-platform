from rest_framework.decorators import api_view, parser_classes
from django.db import models
from django.db.models import Avg, Count, Sum, Q
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from rest_framework import status
from django.utils import timezone
from datetime import timedelta
from rest_framework.parsers import MultiPartParser, FormParser
from .models import Listing, ListingImage, Favorite, Review, ReviewImage, PropertyView, PropertyStats
from bookings.models import Booking
from .serializers import ListingSerializer, ListingImageCreateSerializer, FavoriteSerializer, ReviewSerializer, ReviewCreateSerializer
from .filters import ListingFilter
from django.contrib.auth import get_user_model

User = get_user_model()


@api_view(["GET", "POST"])
@parser_classes([MultiPartParser, FormParser])
def listings_collection(request):
    if request.method == "GET":
        items = ListingFilter(request.GET, queryset=Listing.objects.all())
        return Response(ListingSerializer(items.qs, many=True, context={"request": request}).data)

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
        item.delete()
        return Response({"message": "Listing deleted"}, status=status.HTTP_204_NO_CONTENT)


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
            if not serializer.validated_data.get("order"):
                max_order = listing.gallery_images.aggregate(models.Max("order"))["order__max"] or 0
                serializer.validated_data["order"] = max_order + 1
            image = serializer.save(listing=listing)
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
    reviews = Review.objects.filter(listing=listing)
    return Response(ReviewSerializer(reviews, many=True, context={"request": request}).data)


@api_view(["POST"])
def create_review(request):
    if not request.user.is_authenticated:
        return Response({"error": "Authentication required"}, status=status.HTTP_401_UNAUTHORIZED)

    listing = get_object_or_404(Listing, pk=request.data.get("listing"))

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

    days = int(request.GET.get("days", 30))
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    total_views = PropertyView.objects.filter(listing=listing).count()
    unique_views = PropertyView.objects.filter(listing=listing).values("ip_address").distinct().count()
    total_favorites = Favorite.objects.filter(listing=listing).count()
    total_bookings = Booking.objects.filter(listing=listing).count()
    total_revenue = Booking.objects.filter(listing=listing, status="confirmed").aggregate(
        total=Sum("listing__price"))["total"] or 0

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

    days = int(request.GET.get("days", 30))
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days)

    listings = Listing.objects.filter(owner=user)
    total_listings = listings.count()
    total_views = PropertyView.objects.filter(listing__in=listings).count()
    total_favorites = Favorite.objects.filter(listing__in=listings).count()
    total_bookings = Booking.objects.filter(listing__in=listings).count()
    total_revenue = Booking.objects.filter(listing__in=listings, status="confirmed").aggregate(
        total=Sum("listing__price"))["total"] or 0

    property_stats = []
    for listing in listings:
        views = PropertyView.objects.filter(listing=listing).count()
        favorites = Favorite.objects.filter(listing=listing).count()
        bookings_count = Booking.objects.filter(listing=listing).count()
        revenue = Booking.objects.filter(listing=listing, status="confirmed").aggregate(
            total=Sum("listing__price"))["total"] or 0
        property_stats.append({
            "id": listing.id,
            "title": listing.title,
            "price": str(listing.price),
            "views": views,
            "favorites": favorites,
            "bookings": bookings_count,
            "revenue": str(revenue),
        })

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

    result = []
    for item in view_counts:
        listing = Listing.objects.get(pk=item["listing"])
        favorite_count = Favorite.objects.filter(listing=listing).count()
        result.append({
            "id": listing.id,
            "title": listing.title,
            "price": str(listing.price),
            "property_type": listing.property_type,
            "address": listing.address,
            "main_image_url": listing.main_image.url if listing.main_image else None,
            "owner_username": listing.owner.username,
            "views": item["view_count"],
            "favorites": favorite_count,
        })

    return Response({"popular_listings": result})


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


@api_view(["GET"])
def listing_pricing(request, listing_id):
    from datetime import date as _date, timedelta as _td

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

    nights = (end - start).days
    base_price = float(listing.price)
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
    cleaning_fee = min(50.0, base_price * 0.08)
    service_fee = discounted_subtotal * 0.14
    taxes = (discounted_subtotal + service_fee) * 0.05
    total = discounted_subtotal + cleaning_fee + service_fee + taxes

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
