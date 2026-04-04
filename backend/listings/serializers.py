from rest_framework import serializers
<<<<<<< HEAD
<<<<<<< HEAD
from .models import Listing, ListingImage, Favorite, Review, ReviewImage
from bookings.models import Booking

#Serializer for Listing image model(image uploads)
class ListingImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ListingImage
        fields = ['id','image','image_url','caption','order']
        read_only_fields = ['id']

    def get_image_url(self,obj):
        request = self.context.get('request')
        if obj.image and request:
            return request.build_absolute_uri(obj.image.url)

        return obj.image.url if obj.image else None

#Serializer for Listing model
class ListingSerializer(serializers.ModelSerializer):
    gallery_images = ListingImageSerializer(many=True, read_only=True)
    main_image_url = serializers.SerializerMethodField()
    owner_username = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = Listing
        fields = ["id", "title", "description", "price", "property_type", "address", 
                  "square_footage", "bedrooms", "is_available", "created_at", "updated_at", "gallery_images",
                  "main_image", "main_image_url", "owner_username"
                  ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'owner_username']

    def get_main_image_url(self, obj):
        request = self.context.get('request')
        if obj.main_image and request:
            return request.build_absolute_uri(obj.main_image.url)
        return obj.main_image.url if obj.main_image else None

#Serializer for creating gallery images
class ListingImageCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingImage
        fields = ['image', 'caption', 'order']


#Serializer for Favorite model
class FavoriteSerializer(serializers.ModelSerializer):
    listing_id = serializers.IntegerField(source='listing.id', read_only=True)
    listing = ListingSerializer(read_only=True)

    class Meta:
        model = Favorite
        fields = ['id', 'listing_id', 'listing', 'created_at']
        read_only_fields = ['id', 'listing_id', 'listing', 'created_at']

#Serializer for Review image model
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

#Serializer for Review model
class ReviewSerializer(serializers.ModelSerializer):
    reviewer_username = serializers.CharField(source='reviewer.username', read_only=True)
    reviewer_avatar = serializers.SerializerMethodField()
    images = ReviewImageSerializer(many=True, read_only=True)

    class Meta:
        model = Review
        fields = ['id', 'listing', 'reviewer', 'reviewer_username', 'reviewer_avatar', 
                  'rating', 'title', 'content', 'is_verified', 'created_at', 'updated_at', 'images']
        read_only_fields = ['id', 'reviewer', 'is_verified', 'created_at', 'updated_at']

    #Gets and display user avatar/profile image if exists
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
        fields = ['listing','rating', 'content', 'title']

        
    def create(self, validated_data):
        images_data = validated_data.pop('images', [])
        review = Review.objects.create(**validated_data)

        #Create review images
        for image_data in images_data:
            ReviewImage.objects.create(review=review, image=image_data)
            
        return review
=======
from .models import Listing
=======
from .models import Listing, ListingImage, Favorite, Review, ReviewImage
from bookings.models import Booking
>>>>>>> origin/jake

#Serializer for Listing image model(image uploads)
class ListingImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ListingImage
        fields = ['id','image','image_url','caption','order']
        read_only_fields = ['id']

    def get_image_url(self,obj):
        request = self.context.get('request')
        if obj.image and request:
            return request.build_absolute_uri(obj.image.url)

        return obj.image.url if obj.image else None

#Serializer for Listing model
class ListingSerializer(serializers.ModelSerializer):
    gallery_images = ListingImageSerializer(many=True, read_only=True)
    main_image_url = serializers.SerializerMethodField()
    owner_username = serializers.CharField(source='owner.username', read_only=True)

    class Meta:
        model = Listing
<<<<<<< HEAD
        fields = ["id", "title", "description", "price", "created_at"]
>>>>>>> dalton
=======
        fields = ["id", "title", "description", "price", "property_type", "address", 
                  "square_footage", "bedrooms", "is_available", "created_at", "updated_at", "gallery_images",
                  "main_image", "main_image_url", "owner_username"
                  ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'owner_username']

    def get_main_image_url(self, obj):
        request = self.context.get('request')
        if obj.main_image and request:
            return request.build_absolute_uri(obj.main_image.url)
        return obj.main_image.url if obj.main_image else None

#Serializer for creating gallery images
class ListingImageCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingImage
        fields = ['image', 'caption', 'order']


#Serializer for Favorite model
class FavoriteSerializer(serializers.ModelSerializer):
    listing_id = serializers.IntegerField(source='listing.id', read_only=True)
    listing = ListingSerializer(read_only=True)

    class Meta:
        model = Favorite
        fields = ['id', 'listing_id', 'listing', 'created_at']
        read_only_fields = ['id', 'listing_id', 'listing', 'created_at']

#Serializer for Review image model
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

#Serializer for Review model
class ReviewSerializer(serializers.ModelSerializer):
    reviewer_username = serializers.CharField(source='reviewer.username', read_only=True)
    reviewer_avatar = serializers.SerializerMethodField()
    images = ReviewImageSerializer(many=True, read_only=True)

    class Meta:
        model = Review
        fields = ['id', 'listing', 'reviewer', 'reviewer_username', 'reviewer_avatar', 
                  'rating', 'title', 'content', 'is_verified', 'created_at', 'updated_at', 'images']
        read_only_fields = ['id', 'reviewer', 'is_verified', 'created_at', 'updated_at']

    #Gets and display user avatar/profile image if exists
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
        fields = ['listing','rating', 'content', 'title']

        
    def create(self, validated_data):
        images_data = validated_data.pop('images', [])
        review = Review.objects.create(**validated_data)

        #Create review images
        for image_data in images_data:
            ReviewImage.objects.create(review=review, image=image_data)
            
        return review
>>>>>>> origin/jake
