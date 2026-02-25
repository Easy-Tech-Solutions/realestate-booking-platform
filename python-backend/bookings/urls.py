from django.urls import path
from .views import (bookings_collection, booking_detail, pending_bookings, 
                    confirm_booking, decline_booking, search_alerts, saved_search_detail, 
                    saved_searches,test_search,property_comparisons, comparison_detail,shared_comparison,
                    add_to_comparison, remove_from_comparison)

urlpatterns = [
    path('', bookings_collection, name='bookings_collection'),
    path('<int:id>', booking_detail, name='booking_detail'),
    path('pending/', pending_bookings, name='pending_bookings'),
    path('<int:id>/confirm/', confirm_booking, name='confirm_booking'),
    path('<int:id>/decline/', decline_booking, name='decline_booking'),
    path('searches/', saved_searches, name='saved_searches'),
    path('searches/<int:id>/', saved_search_detail, name='saved_search_detail'),
    path('searches/alerts/', search_alerts, name='search_alerts'),
    path('searches/test/', test_search, name='test_search'),
    path('comparisons/', property_comparisons, name='property_comparison'),
    path('comparisons/<int:id>/', comparison_detail, name='comparison_detail'),
    path('comparisons/shared/<str:token>/', shared_comparison, name='shared_comparison'),
    path('comparisons/add/', add_to_comparison,name='add_to_comparison'),
    path('comparisons/remove/', remove_from_comparison, name='remove_from_comparison'),
]
