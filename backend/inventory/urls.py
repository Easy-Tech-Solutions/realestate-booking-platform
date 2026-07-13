from django.urls import path

from . import views

urlpatterns = [
    path('listings/', views.inventory_listing_list, name='inventory-listing-list'),
    path('listings/bulk/', views.listing_bulk_action, name='inventory-listing-bulk-action'),
    path('listings/<int:pk>/suspend/', views.listing_suspend, name='inventory-listing-suspend'),
    path('listings/<int:pk>/unsuspend/', views.listing_unsuspend, name='inventory-listing-unsuspend'),
    path('listings/<int:pk>/compliance/', views.listing_compliance, name='inventory-listing-compliance'),

    path('flags/', views.listing_flags_list, name='listing-flags-list'),
    path('flags/scan/', views.listing_flags_scan, name='listing-flags-scan'),
    path('flags/manual/', views.listing_flag_create_manual, name='listing-flag-create-manual'),
    path('flags/<int:pk>/review/', views.listing_flag_review, name='listing-flag-review'),
]
