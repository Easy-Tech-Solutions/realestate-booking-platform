import requests
import json

# Login as Jane to get JWT token
login_response = requests.post('http://127.0.0.1:8000/api/auth/login/', json={'email': 'jane@example.com', 'password': 'password123'})
if login_response.status_code == 200:
    token = login_response.json()['access']
    print('Jane logged in successfully')

    # Get John's listing ID (assuming it's 1)
    headers = {'Authorization': f'Bearer {token}'}

    # Create booking
    booking_data = {
        'listing': 1,
        'start_date': '2024-02-01',
        'end_date': '2024-02-05',
        'notes': 'Looking forward to staying here!'
    }

    booking_response = requests.post('http://127.0.0.1:8000/api/bookings/', json=booking_data, headers=headers)
    print(f'Booking creation status: {booking_response.status_code}')
    print(f'Booking response: {booking_response.json()}')
else:
    print('Login failed')
    print(login_response.json())