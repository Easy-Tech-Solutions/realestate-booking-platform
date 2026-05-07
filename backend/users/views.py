from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from .serializers import PublicUserSerializer, UserSerializer
from listings.models import Listing, Favorite
from listings.serializers import ListingSerializer, FavoriteSerializer
from bookings.models import Booking
from bookings.serializers import BookingSerializer
from django.contrib.auth import get_user_model, authenticate
from django.utils import timezone
from datetime import timedelta
from .models import PhoneChangeRequest, Profile
from .utils import generate_otp, send_phone_change_email_otp, send_phone_change_sms_otp
from authapp.throttles import PhoneChangeRateThrottle

User = get_user_model()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def users_collection(request):
    if not request.user.role == 'admin':
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
    items = User.objects.all().order_by("id")
    return Response(PublicUserSerializer(items, many=True).data)



@api_view(["GET"])
@permission_classes([AllowAny])
def user_detail(request, id):
    try:
        u = User.objects.get(pk=id)
    except User.DoesNotExist:
        return Response({"error": "not found"}, status=404)

    return Response(PublicUserSerializer(u).data)

# ── Phone Number Change — 3-step verification flow ────────────────────────────
#
# Step 1  POST /api/users/phone-change/initiate/
#   Body: { "password": "...", "new_phone_number": "...", "network_provider": "mtn"|"orange" }
#   • Re-authenticates the user with their current password.
#   • Creates (or resets) a PhoneChangeRequest row.
#   • Generates a 6-digit OTP, stores its hash-equivalent (plain for dev), sends to email.
#
# Step 2  POST /api/users/phone-change/verify-email/
#   Body: { "otp": "123456" }
#   • Validates the email OTP (expiry checked server-side).
#   • Marks email_otp_verified = True.
#   • Generates a new SMS OTP and sends it to the *new* phone number.
#
# Step 3  POST /api/users/phone-change/verify-sms/
#   Body: { "otp": "654321" }
#   • Validates the SMS OTP (expiry checked server-side).
#   • Updates Profile.momo_number with the new number.
#   • Deletes the PhoneChangeRequest row.
#   • Fires a PHONE_NUMBER_CHANGED in-app + email notification.
#
# Cancel  DELETE /api/users/phone-change/cancel/
#   • Deletes any pending PhoneChangeRequest for the authenticated user.

OTP_VALID_MINUTES = 10


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([PhoneChangeRateThrottle])
def initiate_phone_change(request):
    """
    Step 1: verify password → send email OTP.
    """
    password         = request.data.get('password', '').strip()
    new_phone_number = request.data.get('new_phone_number', '').strip()
    network_provider = request.data.get('network_provider', '').strip().lower()

    if not password or not new_phone_number or not network_provider:
        return Response(
            {'error': 'password, new_phone_number, and network_provider are required.'},
            status=400,
        )

    if network_provider not in ('mtn', 'orange'):
        return Response(
            {'error': 'network_provider must be "mtn" or "orange".'},
            status=400,
        )

    # Re-authenticate with current password
    user = authenticate(request, username=request.user.username, password=password)
    if user is None:
        return Response({'error': 'Incorrect password.'}, status=400)

    # Prevent linking the same number that's already on the profile
    try:
        profile = user.profile
        if profile.momo_number == new_phone_number:
            return Response(
                {'error': 'That number is already linked to your account.'},
                status=400,
            )
    except Exception:
        pass

    # Create or reset the pending request
    otp    = generate_otp()
    expiry = timezone.now() + timedelta(minutes=OTP_VALID_MINUTES)

    PhoneChangeRequest.objects.update_or_create(
        user=user,
        defaults={
            'new_phone_number':  new_phone_number,
            'network_provider':  network_provider,
            'password_verified': True,
            'email_otp':         otp,
            'email_otp_expiry':  expiry,
            'email_otp_verified': False,
            'sms_otp':           '',
            'sms_otp_expiry':    None,
            'sms_otp_verified':  False,
        },
    )

    send_phone_change_email_otp(user, otp)

    return Response({
        'message': (
            f'A verification code has been sent to your email address. '
            f'It expires in {OTP_VALID_MINUTES} minutes.'
        )
    }, status=200)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([PhoneChangeRateThrottle])
def verify_phone_change_email(request):
    """
    Step 2: validate email OTP → send SMS OTP to new number.
    """
    otp = request.data.get('otp', '').strip()
    if not otp:
        return Response({'error': 'otp is required.'}, status=400)

    try:
        req = PhoneChangeRequest.objects.get(user=request.user)
    except PhoneChangeRequest.DoesNotExist:
        return Response(
            {'error': 'No pending phone change request. Please start from Step 1.'},
            status=400,
        )

    if not req.password_verified:
        return Response(
            {'error': 'Password step not completed. Please start from Step 1.'},
            status=400,
        )

    if req.email_otp_verified:
        return Response(
            {'error': 'Email already verified. Please submit your SMS code.'},
            status=400,
        )

    if req.is_email_otp_expired():
        req.delete()
        return Response(
            {'error': 'Verification code has expired. Please start over.'},
            status=400,
        )

    if req.email_otp != otp:
        return Response({'error': 'Invalid verification code.'}, status=400)

    # Email verified — generate and send SMS OTP to the new number
    sms_otp    = generate_otp()
    sms_expiry = timezone.now() + timedelta(minutes=OTP_VALID_MINUTES)

    req.email_otp_verified = True
    req.sms_otp            = sms_otp
    req.sms_otp_expiry     = sms_expiry
    req.save()

    send_phone_change_sms_otp(req.new_phone_number, sms_otp, req.network_provider)

    return Response({
        'message': (
            f'Email verified. A confirmation code has been sent via SMS to '
            f'{req.new_phone_number}. It expires in {OTP_VALID_MINUTES} minutes.'
        )
    }, status=200)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([PhoneChangeRateThrottle])
def verify_phone_change_sms(request):
    """
    Step 3: validate SMS OTP → update phone number → notify user.
    """
    otp = request.data.get('otp', '').strip()
    if not otp:
        return Response({'error': 'otp is required.'}, status=400)

    try:
        req = PhoneChangeRequest.objects.get(user=request.user)
    except PhoneChangeRequest.DoesNotExist:
        return Response(
            {'error': 'No pending phone change request. Please start from Step 1.'},
            status=400,
        )

    if not req.email_otp_verified:
        return Response(
            {'error': 'Email step not completed. Please complete Step 2 first.'},
            status=400,
        )

    if not req.sms_otp:
        return Response(
            {'error': 'SMS code not yet sent. Please complete Step 2 first.'},
            status=400,
        )

    if req.is_sms_otp_expired():
        req.delete()
        return Response(
            {'error': 'SMS code has expired. Please start over.'},
            status=400,
        )

    if req.sms_otp != otp:
        return Response({'error': 'Invalid SMS code.'}, status=400)

    # All 3 steps passed — commit the new phone number
    new_number       = req.new_phone_number
    network_provider = req.network_provider

    profile, _ = request.user.profile.__class__.objects.get_or_create(user=request.user)
    old_number = profile.momo_number
    profile.momo_number = new_number
    profile.save()

    req.delete()

    # Fire notification (imported lazily to avoid circular import)
    try:
        from notifications.services import notify_phone_number_changed
        notify_phone_number_changed(request.user, old_number, new_number, network_provider)
    except Exception:
        pass  # Never block the response due to a notification failure

    network_label = 'MTN Mobile Money' if network_provider == 'mtn' else 'Orange Money'
    return Response({
        'message': (
            f'Your {network_label} number has been updated to {new_number}.'
        )
    }, status=200)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def cancel_phone_change(request):
    """
    Cancel any pending phone change request for the authenticated user.
    """
    deleted, _ = PhoneChangeRequest.objects.filter(user=request.user).delete()
    if deleted:
        return Response({'message': 'Phone change request cancelled.'}, status=200)
    return Response({'message': 'No pending phone change request found.'}, status=200)


#User dashboard view
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_dashboard(request):
    user = request.user

    my_listings = Listing.objects.filter(owner=user).order_by('-created_at')
    bookings_as_customer = Booking.objects.filter(customer=user).order_by('-requested_at')
    bookings_on_my_listings = Booking.objects.filter(listing__owner=user).order_by('-requested_at')

    favorites = (
        Favorite.objects.filter(user=user).select_related('listing').order_by('-created_at')
    )

    return Response({
        'user': UserSerializer(user).data,
        'listings': ListingSerializer(my_listings, many=True, context={'request':request}).data,
        'bookings_as_customer': BookingSerializer(bookings_as_customer, many=True).data,
        'bookings_on_my_listings': BookingSerializer(bookings_on_my_listings, many=True).data,
        'favorites': FavoriteSerializer(favorites, many=True, context = {'request':request}).data,
    })


@api_view(['PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def update_profile(request):
    user = request.user
    data = request.data

    # Update user-level fields
    updatable_fields = ['first_name', 'last_name', 'email']
    changed = [f for f in updatable_fields if f in data and data[f] != '']
    if changed:
        for field in changed:
            setattr(user, field, data[field])
        user.save(update_fields=changed)

    # Update profile fields (image + bio)
    profile, _ = Profile.objects.get_or_create(user=user)
    profile_changed = False
    if 'bio' in data:
        profile.bio = data['bio']
        profile_changed = True
    if 'image' in request.FILES:
        profile.image = request.FILES['image']
        profile_changed = True
    if profile_changed:
        profile.save()

    fresh_user = User.objects.select_related('profile').get(pk=user.pk)
    return Response(UserSerializer(fresh_user).data)
