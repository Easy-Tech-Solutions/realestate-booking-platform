from django.urls import path
from . import views

urlpatterns = [
    # POST /api/property-verifications/                       → submit a listing for verification
    path('', views.property_verifications_collection, name='property-verifications-collection'),

    # GET  /api/property-verifications/for-listing/<id>/      → verification for one of my listings
    path('for-listing/<int:listing_id>/', views.verification_for_listing, name='verification-for-listing'),

    # POST /api/property-verifications/<pk>/resubmit/         → resubmit after correction
    path('<int:pk>/resubmit/', views.resubmit_verification, name='verification-resubmit'),
]
