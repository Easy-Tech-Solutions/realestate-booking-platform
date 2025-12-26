from django.urls import path
from .views import listings_collection, listing_detail, favorite_listing

urlpatterns = [
    path('', listings_collection, name='listings_collection'),
    path('<int:id>', listing_detail, name='listing_detail'),
    path('<int:id>/favorite', favorite_listing, name='favorite_listing'),
]
