from django.urls import path
from .views import bookings_collection, booking_detail, pending_bookings, confirm_booking, decline_booking

urlpatterns = [
    path('', bookings_collection, name='bookings_collection'),
    path('<int:id>', booking_detail, name='booking_detail'),
    path('pending/', pending_bookings, name='pending_bookings'),
    path('<int:id>/confirm/', confirm_booking, name='confirm_booking'),
    path('<int:id>/decline/', decline_booking, name='decline_booking'),
]
