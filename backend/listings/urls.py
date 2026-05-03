from django.urls import path
from .views import (
    categories_collection, category_detail,
    listings_collection, listing_detail, listing_images, listing_image_detail,
    favorite_listing, favorites_collection, listing_reviews, create_review,
    review_detail, user_reviews, listing_stats, agent_analytics, popular_listings,
    platform_stats, listing_availability, listing_pricing, review_response
)

urlpatterns = [
    path('categories/', categories_collection, name='categories_collection'),
    path('categories/<int:id>/', category_detail, name='category_detail'),
    path('', listings_collection, name='listings_collection'),
    path('<int:id>/', listing_detail, name='listing_detail'),
    path('<int:listing_id>/images/', listing_images, name='listing_images'),
    path('<int:listing_id>/images/<int:image_id>/', listing_image_detail, name='listing_image_detail'),
    path('<int:id>/favorite/', favorite_listing, name='favorite_listing'),
    path('favorites/', favorites_collection, name='favorites_collection'),
    path('<int:listing_id>/reviews/', listing_reviews, name='listing_reviews'),
    path('reviews/create/', create_review, name='create_review'),
    path('reviews/<int:id>/', review_detail, name='review_detail'),
    path('users/<int:user_id>/reviews/', user_reviews, name='user_reviews'),
    path('<int:listing_id>/stats/', listing_stats, name='listing_stats'),
    path('analytics/agent/', agent_analytics, name='agent_analytics'),
    path('analytics/popular/', popular_listings, name='popular_listings'),
    path('<int:listing_id>/availability/', listing_availability, name='listing_availability'),
    path('<int:listing_id>/pricing/', listing_pricing, name='listing_pricing'),
    path('reviews/<int:id>/respond/', review_response, name='review_response'),
    path('analytics/platform-stats/', platform_stats, name='platform_stats'),
]
