import logging

from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from realestate_backend.app_logging import log_activity

logger = logging.getLogger(__name__)
from .serializers import PublicUserSerializer, UserSerializer
from listings.models import Listing, Favorite
from listings.serializers import ListingSerializer, FavoriteSerializer
from bookings.models import Booking
from bookings.serializers import BookingSerializer
from django.contrib.auth import get_user_model, authenticate
from django.utils import timezone
from datetime import timedelta
from .models import PhoneChangeRequest, MomoChangeRequest, Profile
from .utils import generate_otp, send_phone_change_email_otp, send_phone_change_sms_otp
from .deletion import delete_account
from authapp.throttles import PhoneChangeRateThrottle

User = get_user_model()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def users_collection(request):
    from rbac.permissions import is_full_admin
    if not is_full_admin(request.user):
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)
    items = User.objects.all().order_by("id")
    return Response(PublicUserSerializer(items, many=True).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def admin_stats(request):
    """Aggregate platform stats for the admin dashboard."""
    if request.user.role not in ('admin', 'superadmin') and not request.user.is_staff:
        return Response({"error": "Permission denied"}, status=status.HTTP_403_FORBIDDEN)

    from django.db.models import Sum, Count
    from listings.models import Listing
    from bookings.models import Booking
    from payments.models import Payment

    total_users = User.objects.count()
    total_listings = Listing.objects.filter(status='published').count()
    total_bookings = Booking.objects.count()
    total_revenue = Payment.objects.filter(status='completed').aggregate(
        total=Sum('amount')
    )['total'] or 0

    recent_users = User.objects.order_by('-date_joined')[:5]
    recent_bookings = Booking.objects.select_related(
        'customer', 'listing'
    ).order_by('-requested_at')[:10]
    recent_payments = Payment.objects.select_related(
        'user', 'booking'
    ).order_by('-created_at')[:10]

    bookings_by_status = dict(
        Booking.objects.values('status').annotate(count=Count('id')).values_list('status', 'count')
    )

    return Response({
        'totals': {
            'users': total_users,
            'listings': total_listings,
            'bookings': total_bookings,
            'revenue': float(total_revenue),
        },
        'bookings_by_status': bookings_by_status,
        'recent_users': PublicUserSerializer(recent_users, many=True).data,
        'recent_bookings': [
            {
                'id': b.id,
                'customer_username': b.customer.username,
                'customer_email': b.customer.email,
                'listing_title': b.listing.title,
                'start_date': b.start_date.isoformat(),
                'end_date': b.end_date.isoformat(),
                'total_price': float(b.total_price),
                'status': b.status,
                'requested_at': b.requested_at.isoformat(),
            }
            for b in recent_bookings
        ],
        'recent_payments': [
            {
                'id': str(p.id),
                'user': p.user.username if p.user else '',
                'amount': float(p.amount),
                'status': p.status,
                'gateway': p.gateway.name if p.gateway else '',
                'created_at': p.created_at.isoformat(),
            }
            for p in recent_payments
        ],
    })



@api_view(["GET"])
@permission_classes([AllowAny])
def user_detail(request, id):
    try:
        u = User.objects.get(pk=id)
    except User.DoesNotExist:
        return Response({"error": "not found"}, status=404)

    return Response(PublicUserSerializer(u).data)

# ── Phone Number Change — 2-step verification flow ────────────────────────────
#
# Step 1  POST /api/users/phone-change/initiate/
#   Body: { "password": "..." (optional for SSO accounts), "new_phone_number": "...",
#           "network_provider": "mtn"|"orange" }
#   • If the user has a usable password (i.e. registered the classic way), the
#     password is required and re-verified. Google-SSO accounts have no usable
#     password, so the field is skipped server-side.
#   • Creates (or resets) a PhoneChangeRequest row.
#   • Generates ONE 6-digit OTP and dispatches the same code via both channels:
#       – the user's email
#       – SMS to the new phone number
#     The user only needs to receive it on one channel to proceed.
#
# Step 2  POST /api/users/phone-change/verify/
#   Body: { "otp": "123456" }
#   • Validates the OTP (expiry checked server-side).
#   • Updates Profile.phone_number (the contact number) with the new value.
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
    Step 1: (optionally verify password) → send email OTP and SMS OTP together.
    """
    password         = request.data.get('password', '').strip()
    new_phone_number = request.data.get('new_phone_number', '').strip()
    network_provider = request.data.get('network_provider', '').strip().lower()

    if not new_phone_number or not network_provider:
        return Response(
            {'error': 'new_phone_number and network_provider are required.'},
            status=400,
        )

    if network_provider not in ('mtn', 'orange'):
        return Response(
            {'error': 'network_provider must be "mtn" or "orange".'},
            status=400,
        )

    user = request.user
    requires_password = user.has_usable_password()

    if requires_password:
        if not password:
            return Response(
                {'error': 'Current password is required.', 'code': 'password_required'},
                status=400,
            )
        if authenticate(request, username=user.username, password=password) is None:
            return Response({'error': 'Incorrect password.'}, status=400)

    # Prevent linking the same number that's already on the profile
    try:
        profile = user.profile
        if profile.phone_number == new_phone_number:
            return Response(
                {'error': 'That number is already linked to your account.'},
                status=400,
            )
    except Exception:
        pass

    # Same OTP delivered through two channels so the user can use whichever
    # arrives first. Both columns store the same value for schema consistency.
    otp    = generate_otp()
    expiry = timezone.now() + timedelta(minutes=OTP_VALID_MINUTES)

    PhoneChangeRequest.objects.update_or_create(
        user=user,
        defaults={
            'new_phone_number':   new_phone_number,
            'network_provider':   network_provider,
            'password_verified':  True,
            'email_otp':          otp,
            'email_otp_expiry':   expiry,
            'email_otp_verified': False,
            'sms_otp':            otp,
            'sms_otp_expiry':     expiry,
            'sms_otp_verified':   False,
        },
    )

    try:
        send_phone_change_email_otp(user, otp, purpose_label='phone number')
    except Exception:
        logger.exception("initiate_phone_change: failed to send email OTP")
        return Response(
            {'error': 'Could not send the verification code. Please try again in a moment.'},
            status=503,
        )
    send_phone_change_sms_otp(new_phone_number, otp, network_provider, purpose_label='phone number')

    return Response({
        'message': (
            f'A verification code has been sent to your email and to '
            f'{new_phone_number}. It expires in {OTP_VALID_MINUTES} minutes.'
        ),
    }, status=200)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([PhoneChangeRateThrottle])
def verify_phone_change(request):
    """
    Step 2: validate the OTP → update phone number → notify user.
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

    if req.is_email_otp_expired():
        req.delete()
        return Response(
            {'error': 'Verification code has expired. Please start over.'},
            status=400,
        )

    if req.email_otp != otp:
        return Response({'error': 'Invalid verification code.'}, status=400)

    new_number       = req.new_phone_number
    network_provider = req.network_provider

    profile, _ = request.user.profile.__class__.objects.get_or_create(user=request.user)
    old_number = profile.phone_number
    profile.phone_number = new_number
    profile.save()

    req.delete()

    try:
        from notifications.services import notify_phone_number_changed
        notify_phone_number_changed(request.user, old_number, new_number, network_provider)
    except Exception:
        pass  # Never block the response due to a notification failure

    return Response({
        'message': f'Your phone number has been updated to {new_number}.',
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


# ── Host MoMo (payout) Number Change — 2-step verification ────────────────────
#
# Same OTP mechanics as the phone-change flow above, but the number is
# money-bearing, so:
#   • Only an APPROVED host may change it.
#   • The new number is written to the host's approved HostApplication.momo_number
#     (the canonical payout destination) — never the Profile.
#   • network is fixed to 'mtn' (only MTN is payable) and not collected on the
#     frontend; the number is validated as an MTN wallet.
#
#   POST   /api/users/momo-change/initiate/  { password?, new_momo_number }
#   POST   /api/users/momo-change/verify/    { otp }
#   DELETE /api/users/momo-change/cancel/


def _approved_host_application(user):
    from hostapplications.models import HostApplication
    return HostApplication.approved_for(user)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([PhoneChangeRateThrottle])
def initiate_momo_change(request):
    """Step 1: confirm the caller is an approved host, (optionally) verify the
    password, validate the new MTN number, and send email + SMS OTPs."""
    from rest_framework import serializers as drf_serializers
    from hostapplications.serializers import validate_mtn_momo_number

    application = _approved_host_application(request.user)
    if application is None:
        return Response(
            {'error': 'Only approved hosts can change their payout number.'},
            status=403,
        )

    password        = request.data.get('password', '').strip()
    new_momo_number = request.data.get('new_momo_number', '').strip()

    if not new_momo_number:
        return Response({'error': 'new_momo_number is required.'}, status=400)

    try:
        validate_mtn_momo_number(new_momo_number)
    except drf_serializers.ValidationError as exc:
        detail = exc.detail[0] if isinstance(exc.detail, (list, tuple)) else exc.detail
        return Response({'error': str(detail)}, status=400)

    user = request.user
    if user.has_usable_password():
        if not password:
            return Response(
                {'error': 'Current password is required.', 'code': 'password_required'},
                status=400,
            )
        if authenticate(request, username=user.username, password=password) is None:
            return Response({'error': 'Incorrect password.'}, status=400)

    if application.momo_number == new_momo_number:
        return Response({'error': 'That is already your payout number.'}, status=400)

    # Same OTP delivered via email and SMS; the host uses whichever arrives.
    otp    = generate_otp()
    expiry = timezone.now() + timedelta(minutes=OTP_VALID_MINUTES)

    MomoChangeRequest.objects.update_or_create(
        user=user,
        defaults={
            'new_momo_number':    new_momo_number,
            'network_provider':   MomoChangeRequest.NETWORK_MTN,
            'password_verified':  True,
            'email_otp':          otp,
            'email_otp_expiry':   expiry,
            'email_otp_verified': False,
            'sms_otp':            otp,
            'sms_otp_expiry':     expiry,
            'sms_otp_verified':   False,
        },
    )

    try:
        send_phone_change_email_otp(user, otp, purpose_label='Mobile Money number')
    except Exception:
        logger.exception("initiate_momo_change: failed to send email OTP")
        return Response(
            {'error': 'Could not send the verification code. Please try again in a moment.'},
            status=503,
        )
    send_phone_change_sms_otp(new_momo_number, otp, MomoChangeRequest.NETWORK_MTN,
                              purpose_label='Mobile Money number')

    return Response({
        'message': (
            f'A verification code has been sent to your email and to '
            f'{new_momo_number}. It expires in {OTP_VALID_MINUTES} minutes.'
        ),
    }, status=200)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@throttle_classes([PhoneChangeRateThrottle])
def verify_momo_change(request):
    """Step 2: validate the OTP → write the new number to the approved
    application's momo_number → notify the host."""
    otp = request.data.get('otp', '').strip()
    if not otp:
        return Response({'error': 'otp is required.'}, status=400)

    try:
        req = MomoChangeRequest.objects.get(user=request.user)
    except MomoChangeRequest.DoesNotExist:
        return Response(
            {'error': 'No pending MoMo number change request. Please start from Step 1.'},
            status=400,
        )

    if req.is_email_otp_expired():
        req.delete()
        return Response({'error': 'Verification code has expired. Please start over.'}, status=400)

    if req.email_otp != otp:
        return Response({'error': 'Invalid verification code.'}, status=400)

    application = _approved_host_application(request.user)
    if application is None:
        req.delete()
        return Response(
            {'error': 'Only approved hosts can change their payout number.'},
            status=403,
        )

    new_number = req.new_momo_number
    old_number = application.momo_number
    application.momo_number  = new_number
    application.momo_network = req.network_provider
    application.save(update_fields=['momo_number', 'momo_network', 'updated_at'])

    req.delete()

    try:
        from notifications.services import notify_phone_number_changed
        notify_phone_number_changed(request.user, old_number, new_number, req.network_provider)
    except Exception:
        pass  # Never block the response due to a notification failure

    return Response({
        'message': f'Your Mobile Money payout number has been updated to {new_number}.',
    }, status=200)


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def cancel_momo_change(request):
    """Cancel any pending MoMo change request for the authenticated user."""
    deleted, _ = MomoChangeRequest.objects.filter(user=request.user).delete()
    if deleted:
        return Response({'message': 'MoMo change request cancelled.'}, status=200)
    return Response({'message': 'No pending MoMo change request found.'}, status=200)


#User dashboard view
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_dashboard(request):
    user = request.user

    my_listings = Listing.objects.filter(owner=user, deleted_at__isnull=True).order_by('-created_at')
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


_MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB


@api_view(['PUT', 'PATCH'])
@permission_classes([IsAuthenticated])
def update_profile(request):
    user = request.user
    data = request.data

    if 'image' in request.FILES and request.FILES['image'].size > _MAX_IMAGE_BYTES:
        return Response(
            {"error": "Image file is too large. Maximum allowed is 10 MB."},
            status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )

    # Update user-level fields
    updatable_fields = ['first_name', 'last_name', 'email']
    changed = [f for f in updatable_fields if f in data and data[f] != '']
    if changed:
        for field in changed:
            setattr(user, field, data[field])
        user.save(update_fields=changed)

    # Role changes — only allow self-promotion between 'user' and 'agent'.
    # Admin/superadmin roles are intentionally NOT writable here to prevent
    # privilege escalation (or accidental self-demotion) — those are
    # provisioned via the Management dashboard (superadmin-only) or the
    # Django admin / shell.
    if 'role' in data and data['role'] in ('user', 'agent') and user.role not in ('admin', 'superadmin'):
        if user.role != data['role']:
            user.role = data['role']
            user.save(update_fields=['role'])

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


@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_my_account(request):
    """Soft-delete the authenticated user's account.

    Blocked if the user has any active/upcoming bookings as guest *or* as
    host on their listings. Returns 400 with a specific reason in that case
    so the frontend can render it verbatim.
    """
    user_id = request.user.id
    ok, error = delete_account(request.user)
    if not ok:
        return Response({'detail': error}, status=status.HTTP_400_BAD_REQUEST)
    log_activity(request, 'account_deletion_initiated', resource_type='user', resource_id=user_id)
    return Response(status=status.HTTP_204_NO_CONTENT)
