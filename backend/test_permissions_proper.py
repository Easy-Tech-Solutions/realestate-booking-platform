import os
import sys
import django

# Add the project directory to the path
sys.path.insert(0, os.path.dirname(__file__))

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'realestate_backend.settings')
django.setup()

from django.urls import reverse
from rest_framework.test import APIClient, APITestCase
from django.contrib.auth import get_user_model
from bookings.models import Booking
from listings.models import Listing
from rest_framework_simplejwt.tokens import RefreshToken

class BookingPermissionsTest(APITestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        
        # Get existing users
        self.jane = User.objects.get(email='jane@example.com')
        self.john = User.objects.get(email='john@example.com')
        
        # Get the booking
        self.booking = Booking.objects.filter(customer=self.jane).first()
        
        # Create test user
        self.other_user = User.objects.create_user(
            username='test_user',
            email='test@example.com',
            password='password123',
            email_verified=True
        )

    def test_jane_can_view_her_booking(self):
        """Test that Jane can view her own booking"""
        refresh = RefreshToken.for_user(self.jane)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        
        url = reverse('booking_detail', kwargs={'id': self.booking.id})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        print("✓ Jane can view her own booking")

    def test_john_can_view_booking_for_his_listing(self):
        """Test that John can view bookings for his listings"""
        refresh = RefreshToken.for_user(self.john)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        
        url = reverse('booking_detail', kwargs={'id': self.booking.id})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        print("✓ John can view booking for his listing")

    def test_other_user_cannot_view_booking(self):
        """Test that other users cannot view the booking"""
        refresh = RefreshToken.for_user(self.other_user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        
        url = reverse('booking_detail', kwargs={'id': self.booking.id})
        response = self.client.get(url)
        self.assertEqual(response.status_code, 403)
        print("✓ Other user correctly denied access")

# Run the tests
if __name__ == '__main__':
    import unittest
    unittest.main()