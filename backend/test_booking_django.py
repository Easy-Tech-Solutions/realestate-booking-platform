import os
import sys
import django
from datetime import date

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from bookings.models import Booking
from listings.models import Listing
from rest_framework_simplejwt.tokens import RefreshToken

class BookingAPITestCase(APITestCase):
    """
    Test suite for the booking creation API endpoint.
    This test will be run via `python manage.py test`.
    """
    def setUp(self):
        """Set up the test data."""
        User = get_user_model()
        self.host = User.objects.create_user(username='host', email='john@example.com', password='password123')
        self.guest = User.objects.create_user(username='guest', email='jane@example.com', password='password123')

        self.listing = Listing.objects.create(
            owner=self.host,
            title="Test Beach House",
            address="123 Ocean Drive, Testville, USA",
            price=100.00,
        )

        # Authenticate the client as the guest
        self.client.force_authenticate(user=self.guest)

    def test_create_booking_successfully(self):
        """Ensure an authenticated user can create a booking for a listing."""
        booking_data = {
            'listing': self.listing.id,
            'start_date': date(2024, 10, 1),
            'end_date': date(2024, 10, 5),
            'notes': 'Looking forward to staying here!'
        }

        response = self.client.post('/api/bookings/', booking_data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Booking.objects.count(), 1)
        booking = Booking.objects.first()
        self.assertEqual(booking.guest, self.guest)
        self.assertEqual(booking.listing, self.listing)