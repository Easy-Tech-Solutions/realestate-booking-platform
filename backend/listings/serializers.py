from rest_framework import serializers
import json
from .models import Listing, ListingImage, Favorite, Review, ReviewImage, PropertyCategory


class PropertyCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = PropertyCategory
        fields = ['id', 'name', 'slug', 'is_active', 'sort_order']
        read_only_fields = ['id']
        extra_kwargs = {
            'slug': {'required': False, 'allow_blank': True},
        }


class ListingImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ListingImage
        fields = ['id', 'image', 'image_url', 'caption', 'order']
        read_only_fields = ['id']

    def get_image_url(self, obj):
        request = self.context.get('request')
        if obj.image and request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url if obj.image else None


class ListingSerializer(serializers.ModelSerializer):
    gallery_images = ListingImageSerializer(many=True, read_only=True)
    main_image_url = serializers.SerializerMethodField()
    owner_username = serializers.CharField(source='owner.username', read_only=True)
    owner_id = serializers.IntegerField(source='owner.id', read_only=True)
    owner_first_name = serializers.CharField(source='owner.first_name', read_only=True)
    owner_last_name = serializers.CharField(source='owner.last_name', read_only=True)
    owner_avatar = serializers.SerializerMethodField()
    owner_is_superhost = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id", "title", "description", "price", "property_type", "privacy_type",
            "address", "city", "state", "country", "latitude", "longitude",
            "check_in_time", "check_out_time", "self_checkin",
            "square_footage", "bedrooms", "beds", "bathrooms", "max_guests",
            "amenities", "highlights", "booking_mode", "cancellation_policy",
            "weekend_premium_percent",
            "new_listing_promo",
            "last_minute_discount_enabled", "last_minute_discount_percent",
            "weekly_discount_enabled", "weekly_discount_percent",
            "monthly_discount_enabled", "monthly_discount_percent",
            "exterior_camera", "noise_monitor", "weapons_on_property",
            "is_available", "created_at", "updated_at",
            "gallery_images", "main_image", "main_image_url",
            "owner_username", "owner_id", "owner_first_name", "owner_last_name",
            "owner_avatar", "owner_is_superhost",
            "average_rating", "review_count",
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'owner_username', 'owner_id']

    def get_main_image_url(self, obj):
        request = self.context.get('request')
        if obj.main_image and request:
            return request.build_absolute_uri(obj.main_image.url)
        return obj.main_image.url if obj.main_image else None

    def get_owner_avatar(self, obj):
        request = self.context.get('request')
        try:
            if obj.owner.profile.image:
                if request:
                    return request.build_absolute_uri(obj.owner.profile.image.url)
                return obj.owner.profile.image.url
        except Exception:
            pass
        return None

    def get_owner_is_superhost(self, obj):
        try:
            return obj.owner.profile.is_superhost
        except Exception:
            return False

    def get_average_rating(self, obj):
        from django.db.models import Avg
        result = obj.reviews.aggregate(avg=Avg('rating'))['avg']
        return round(result, 2) if result else None

    def get_review_count(self, obj):
        return obj.reviews.count()

    def _normalize_list_field(self, value, field_name):
        if value is None or value == '':
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise serializers.ValidationError(f"{field_name} must be a valid JSON array.") from exc
            if isinstance(parsed, list):
                return parsed
            raise serializers.ValidationError(f"{field_name} must be a list.")
        raise serializers.ValidationError(f"{field_name} must be a list.")

    def validate_amenities(self, value):
        return self._normalize_list_field(value, 'amenities')

    def validate_highlights(self, value):
        return self._normalize_list_field(value, 'highlights')

    def validate_property_type(self, value):
        category_slug = (value or '').strip().lower()
        if not category_slug:
            # Default to 'homes' if the field is empty or None
            return 'homes'

        if not PropertyCategory.objects.filter(slug=category_slug, is_active=True).exists():
            active_slugs = list(PropertyCategory.objects.filter(is_active=True).values_list('slug', flat=True))
            raise serializers.ValidationError(
                f"Invalid property_type '{value}'. Valid options are: {', '.join(active_slugs)}"
            )
        return category_slug


class ListingImageCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingImage
        fields = ['image', 'caption', 'order']


class FavoriteSerializer(serializers.ModelSerializer):
    listing_id = serializers.IntegerField(source='listing.id', read_only=True)
    listing = ListingSerializer(read_only=True)

    class Meta:
        model = Favorite
        fields = ['id', 'listing_id', 'listing', 'created_at']
        read_only_fields = ['id', 'listing_id', 'listing', 'created_at']


class ReviewImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ReviewImage
        fields = ['id', 'image', 'image_url', 'caption', 'created_at']
        read_only_fields = ['id', 'created_at']

    def get_image_url(self, obj):
        request = self.context.get('request')
        if obj.image and request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url if obj.image else None


class ReviewSerializer(serializers.ModelSerializer):
    reviewer_username = serializers.CharField(source='reviewer.username', read_only=True)
    reviewer_avatar = serializers.SerializerMethodField()
    images = ReviewImageSerializer(many=True, read_only=True)

    class Meta:
        model = Review
        fields = [
            'id', 'listing', 'reviewer', 'reviewer_username', 'reviewer_avatar',
            'rating', 'cleanliness', 'accuracy', 'check_in_rating',
            'communication', 'location_rating', 'value',
            'title', 'content', 'host_response', 'host_response_at',
            'is_verified', 'created_at', 'updated_at', 'images'
        ]
        read_only_fields = ['id', 'reviewer', 'is_verified', 'created_at', 'updated_at',
                            'host_response', 'host_response_at']

    def get_reviewer_avatar(self, obj):
        request = self.context.get('request')
        if hasattr(obj.reviewer, 'profile') and obj.reviewer.profile.image:
            if request:
                return request.build_absolute_uri(obj.reviewer.profile.image.url)
            return obj.reviewer.profile.image.url
        return None


class ReviewCreateSerializer(serializers.ModelSerializer):
    images = serializers.ListField(child=serializers.ImageField(), write_only=True, required=False)

    class Meta:
        model = Review
        fields = ['listing', 'rating', 'cleanliness', 'accuracy', 'check_in_rating',
                  'communication', 'location_rating', 'value', 'content', 'title', 'images']

    def create(self, validated_data):
        images_data = validated_data.pop('images', [])
        review = Review.objects.create(**validated_data)
        for image_data in images_data:
            ReviewImage.objects.create(review=review, image=image_data)
        return review
