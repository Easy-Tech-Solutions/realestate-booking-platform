from django.urls import path
from .views import bookings_collection, booking_detail

urlpatterns = [
    path('', bookings_collection, name='bookings_collection'),
    path('<int:id>', booking_detail, name='booking_detail'),
]
