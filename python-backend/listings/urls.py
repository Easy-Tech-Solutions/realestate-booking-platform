from django.urls import path
from .views import listings_collection, listing_detail, listing_images, listing_image_detail, favorite_listing, favorites_collection

urlpatterns = [
    path('', listings_collection, name='listings_collection'),
    path('<int:id>', listing_detail, name='listing_detail'),
    path('<int:listing_id>/images/', listing_images, name='listing_images'),
    path('<int:listing_id>/images/<int:image_id>', listing_image_detail, name='listing_image_detail'),
    path('<int:id>/favorite/', favorite_listing, name='favorite_listing'),
    path('favorites/', favorites_collection, name='favorites_collection'),
]
