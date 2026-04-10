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

# Test booking creation
client = APIClient()

# Get users
User = get_user_model()
try:
    jane = User.objects.get(email='jane@example.com')
    john = User.objects.get(email='john@example.com')
    print("Users found")

    # Get John's listing
    listing = Listing.objects.filter(owner=john).first()
    if listing:
        print(f"Found listing: {listing.title}")

        # Create JWT token for Jane
        refresh = RefreshToken.for_user(jane)
        access_token = str(refresh.access_token)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {access_token}')

        # Create booking
        booking_data = {
            'listing': listing.id,
            'start_date': '2024-02-01',
            'end_date': '2024-02-05',
            'notes': 'Looking forward to staying here!'
        }

        response = client.post('/api/bookings/', booking_data, format='json')
        print(f"Booking creation status: {response.status_code}")
        print(f"Booking response: {response.data}")

        if response.status_code == 201:
            print("SUCCESS: Booking created successfully!")
        else:
            print("FAILED: Booking creation failed")
    else:
        print("No listing found for John")

except User.DoesNotExist as e:
    print(f"User not found: {e}")
except Exception as e:
    print(f"Error: {e}")