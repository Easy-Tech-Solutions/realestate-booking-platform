from rest_framework import serializers
from .models import Booking, SavedSearch, SearchAlert, ComparisonItem, PropertyComparison
from listings.serializers import ListingSerializer
from django.utils import timezone


class BookingConfrimationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ['status', 'owner_notes', 'decline_reason']


class BookingSerializer(serializers.ModelSerializer):
    customer_username = serializers.CharField(source='customer.username', read_only=True)
    listing_title = serializers.CharField(source='listing.title', read_only=True)
    listing_owner = serializers.CharField(source='listing.owner.username', read_only=True)
    days_until_expiry = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            'id', 'customer', 'customer_username', 'listing', 'listing_title',
            'listing_owner', 'start_date', 'end_date', 'status', 'notes',
            'requested_at', 'confirmed_at', 'declined_at', 'owner_notes',
            'decline_reason', 'days_until_expiry'
        ]
        read_only_fields = ['customer', 'requested_at', 'confirmed_at', 'declined_at']

    def get_days_until_expiry(self, obj):
        if obj.status == 'requested' and obj.requested_at:
            from datetime import timedelta
            expiry_time = obj.requested_at + timedelta(hours=48)
            remaining = expiry_time - timezone.now()
            return max(0, remaining.days)
        return 0


class BookingCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = ['listing', 'start_date', 'end_date', 'notes']

    def validate(self, data):
        if data['start_date'] >= data['end_date']:
            raise serializers.ValidationError('End date must be after start date')
        if data['start_date'] < timezone.now().date():
            raise serializers.ValidationError('Start date cannot be in the past')
        return data


class SavedSearchSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True)
    email_frequency_display = serializers.CharField(source='get_email_frequency_display', read_only=True)
    listing_count = serializers.SerializerMethodField()

    class Meta:
        model = SavedSearch
        fields = [
            'id', 'name', 'user', 'user_username', 'min_price', 'max_price',
            'property_type', 'min_bedrooms', 'max_bedrooms', 'min_square_footage',
            'max_square_footage', 'address', 'keywords', 'is_available',
            'email_frequency', 'email_frequency_display', 'is_active',
            'created_at', 'updated_at', 'listing_count'
        ]
        read_only_fields = ['user', 'created_at', 'updated_at']

    def get_listing_count(self, obj):
        return obj.alerts.count()


class SearchAlertSerializer(serializers.ModelSerializer):
    listing_title = serializers.CharField(source='listing.title', read_only=True)
    listing_price = serializers.CharField(source='listing.price', read_only=True)
    listing_address = serializers.CharField(source='listing.address', read_only=True)
    listing_image = serializers.SerializerMethodField()
    saved_search_name = serializers.CharField(source='saved_search.name', read_only=True)

    class Meta:
        model = SearchAlert
        fields = [
            'id', 'saved_search', 'listing', 'listing_title', 'listing_price',
            'listing_address', 'listing_image', 'saved_search_name', 'sent_at'
        ]
        read_only_fields = ['sent_at']

    def get_listing_image(self, obj):
        request = self.context.get('request')
        if obj.listing.main_image and request:
            return request.build_absolute_uri(obj.listing.main_image.url)
        return obj.listing.main_image.url if obj.listing.main_image else None


class SavedSearchCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedSearch
        fields = [
            'name', 'min_price', 'max_price', 'property_type', 'min_bedrooms',
            'max_bedrooms', 'min_square_footage', 'max_square_footage',
            'address', 'keywords', 'is_available', 'email_frequency'
        ]

    def validate(self, data):
        if data.get('min_price') and data.get('max_price'):
            if data['min_price'] >= data['max_price']:
                raise serializers.ValidationError('Min price must be less than max price')
        if data.get('min_bedrooms') and data.get('max_bedrooms'):
            if data['min_bedrooms'] >= data['max_bedrooms']:
                raise serializers.ValidationError('Min bedrooms must be less than max bedrooms')
        if data.get('min_square_footage') and data.get('max_square_footage'):
            if data['min_square_footage'] >= data['max_square_footage']:
                raise serializers.ValidationError('Min square footage must be less than max square footage')
        return data


class ComparisonItemSerializer(serializers.ModelSerializer):
    listing = ListingSerializer(read_only=True)
    listing_title = serializers.CharField(source='listing.title', read_only=True)
    score = serializers.SerializerMethodField()
    advantages = serializers.SerializerMethodField()
    disadvantages = serializers.SerializerMethodField()

    class Meta:
        model = ComparisonItem
        fields = ['id', 'listing', 'listing_title', 'order', 'notes', 'score', 'advantages', 'disadvantages']

    def get_score(self, obj):
        score = 0
        if obj.listing.price:
            avg_price = 1500
            price_score = max(0, 100 - (float(obj.listing.price) / avg_price * 100))
            score += price_score * 0.3
        if obj.listing.bedrooms:
            score += min(100, obj.listing.bedrooms * 20) * 0.3
        if obj.listing.square_footage:
            score += min(100, obj.listing.square_footage / 10) * 0.4
        return round(score, 1)

    def get_advantages(self, obj):
        advantages = []
        if obj.listing.bedrooms >= 3:
            advantages.append(f'{obj.listing.bedrooms} bedrooms - great for families')
        if obj.listing.square_footage >= 1000:
            advantages.append(f'Spacious {obj.listing.square_footage} sq ft')
        if float(obj.listing.price) <= 1500:
            advantages.append('Affordable pricing')
        return advantages

    def get_disadvantages(self, obj):
        disadvantages = []
        if obj.listing.bedrooms <= 1:
            disadvantages.append('Only 1 bedroom')
        if obj.listing.square_footage <= 500:
            disadvantages.append(f'Small {obj.listing.square_footage} sq ft')
        if float(obj.listing.price) >= 2500:
            disadvantages.append('Higher price point')
        return disadvantages


class PropertyComparisonSerializer(serializers.ModelSerializer):
    user_username = serializers.CharField(source='user.username', read_only=True)
    items = ComparisonItemSerializer(many=True, read_only=True)
    total_properties = serializers.SerializerMethodField()
    share_url = serializers.SerializerMethodField()
    average_price = serializers.SerializerMethodField()
    average_bedrooms = serializers.SerializerMethodField()
    average_square_footage = serializers.SerializerMethodField()

    class Meta:
        model = PropertyComparison
        fields = [
            'id', 'name', 'user', 'user_username', 'items', 'total_properties',
            'share_url', 'average_price', 'average_bedrooms', 'average_square_footage',
            'is_public', 'share_token', 'created_at', 'updated_at'
        ]
        read_only_fields = ['user', 'created_at', 'updated_at', 'share_token']

    def get_total_properties(self, obj):
        return obj.items.count()

    def get_share_url(self, obj):
        if obj.is_public and obj.share_token:
            request = self.context.get('request')
            if request:
                return f"{request.build_absolute_uri('/')}comparisons/{obj.share_token}/"
        return None

    def get_average_price(self, obj):
        items = list(obj.items.all())
        if items:
            return round(sum(float(item.listing.price) for item in items) / len(items), 2)
        return 0

    def get_average_bedrooms(self, obj):
        items = list(obj.items.all())
        if items:
            return round(sum(item.listing.bedrooms for item in items) / len(items), 1)
        return 0

    def get_average_square_footage(self, obj):
        items = list(obj.items.all())
        if items:
            return round(sum(item.listing.square_footage for item in items) / len(items), 0)
        return 0


class ComparisonCreateSerializer(serializers.ModelSerializer):
    listing_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        help_text='List of Listing IDs to compare'
    )
    name = serializers.CharField(max_length=100, required=True)
    is_public = serializers.BooleanField(default=False, required=False)

    class Meta:
        model = PropertyComparison
        fields = ['listing_ids', 'name', 'is_public']

    def validate_listing_ids(self, value):
        if len(value) < 2:
            raise serializers.ValidationError('At least two properties required for comparison')
        if len(value) > 4:
            raise serializers.ValidationError('Maximum 4 properties allowed for comparison')
        return value
