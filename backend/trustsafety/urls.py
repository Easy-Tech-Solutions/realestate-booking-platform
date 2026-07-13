from django.urls import path

from . import views

urlpatterns = [
    path('fraud-flags/', views.fraud_flags_list, name='fraud-flags-list'),
    path('fraud-flags/scan/', views.fraud_flags_scan, name='fraud-flags-scan'),
    path('fraud-flags/manual/', views.fraud_flag_create_manual, name='fraud-flag-create-manual'),
    path('fraud-flags/<int:pk>/review/', views.fraud_flag_review, name='fraud-flag-review'),

    path('blocked-fingerprints/', views.blocked_fingerprints, name='blocked-fingerprints'),
    path('blocked-fingerprints/<int:pk>/', views.blocked_fingerprint_detail, name='blocked-fingerprint-detail'),

    path('blacklisted-locations/', views.blacklisted_locations, name='blacklisted-locations'),
    path('blacklisted-locations/<int:pk>/', views.blacklisted_location_detail, name='blacklisted-location-detail'),
]
