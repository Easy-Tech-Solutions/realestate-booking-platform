from rest_framework import serializers
from .models import Listing, ListingImage, Favorite



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

        

class ListingImageCreateSerializer(serializers.ModelSerializer):

    #Serializer for creating gallery images

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
