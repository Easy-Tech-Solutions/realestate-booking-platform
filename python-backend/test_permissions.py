import os
import sys
import django

# Add the project directory to the path
sys.path.insert(0, os.path.dirname(__file__))

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'realestate_backend.settings')
django.setup()

# Now import Django modules
from django.test import TestCase
from django.test.client import Client
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from bookings.models import Booking
from listings.models import Listing
from rest_framework_simplejwt.tokens import RefreshToken

# Test booking permissions
client = APIClient()

# Get users
User = get_user_model()
try:
    jane = User.objects.get(email='jane@example.com')
    john = User.objects.get(email='john@example.com')
    print("Users found")

    # Get the booking Jane just created
    booking = Booking.objects.filter(customer=jane).first()
    if booking:
        print(f"Found booking: {booking}")

        # Test 1: Jane (customer) should be able to view her bookings list
        refresh = RefreshToken.for_user(jane)
        access_token = str(refresh.access_token)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

        response = client.get('/api/bookings/')
        print(f"Jane viewing her bookings list: {response.status_code}")
        if response.status_code == 200:
            print("✓ Jane can view her bookings list")
            print(f"Bookings: {response.data}")
        else:
            print(f"✗ Jane cannot view her bookings list - Response: {response}")

        # Test booking detail access
        response = client.get(f'/api/bookings/{booking.id}/')
        print(f"Jane viewing her booking detail: {response.status_code}")
        if response.status_code == 200:
            print("✓ Jane can view her own booking")
        else:
            print(f"✗ Jane cannot view her own booking - Status: {response.status_code}")

        # Test 2: John (listing owner) should be able to view the booking
        refresh = RefreshToken.for_user(john)
        access_token = str(refresh.access_token)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

        response = client.get(f'/api/bookings/{booking.id}/')
        print(f"John viewing booking for his listing: {response.status_code}")
        if response.status_code == 200:
            print("✓ John can view booking for his listing")
        else:
            print("✗ John cannot view booking for his listing")

        # Test 3: Create another user and test they cannot access
        # First create a new user for testing
        other_user = User.objects.create_user(
            username='test_user',
            email='test@example.com',
            password='password123',
            email_verified=True
        )

        refresh = RefreshToken.for_user(other_user)
        access_token = str(refresh.access_token)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

        response = client.get(f'/api/bookings/{booking.id}/')
        print(f"Other user viewing booking: {response.status_code}")
        if response.status_code == 403:
            print("✓ Other user correctly denied access")
        else:
            print("✗ Other user incorrectly allowed access")

        # Clean up test user
        other_user.delete()

    else:
        print("No booking found")

except User.DoesNotExist as e:
    print(f"User not found: {e}")
except Exception as e:
    print(f"Error: {e}")