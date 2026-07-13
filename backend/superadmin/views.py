import base64
import io
import secrets

import pyotp
import qrcode
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core.signing import BadSignature, SignatureExpired, TimestampSigner
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import AccessToken

from .constants import DEPARTMENTS
from .models import AdminAuditLog, ImpersonationSession, MFADevice
from .permissions import (
    get_client_ip, is_full_admin, is_superadmin_staff,
    log_admin_action, user_departments,
)
from .serializers import AdminAuditLogSerializer, ImpersonationSessionSerializer
from .throttles import MFAVerifyLoginRateThrottle

User = get_user_model()

MFA_LOGIN_SALT = 'superadmin-mfa-login'
MFA_TOKEN_MAX_AGE = 300  # 5 minutes to enter the code after password auth
BACKUP_CODE_COUNT = 8


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    user = request.user
    if not is_superadmin_staff(user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    device = MFADevice.objects.filter(user=user).first()
    return Response({
        'is_full_admin': is_full_admin(user),
        'departments': user_departments(user),
        'all_departments': [slug for slug, _ in DEPARTMENTS],
        'mfa_enabled': bool(device and device.confirmed),
    })


# ── MFA enrollment (while already logged in) ────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mfa_setup(request):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    device = MFADevice.objects.filter(user=request.user).first()
    if device and device.confirmed:
        return Response({'error': 'MFA is already enabled. Disable it first to re-enroll.'}, status=status.HTTP_400_BAD_REQUEST)

    secret = pyotp.random_base32()
    MFADevice.objects.update_or_create(
        user=request.user,
        defaults={'secret': secret, 'confirmed': False, 'backup_codes': []},
    )

    otpauth_url = pyotp.TOTP(secret).provisioning_uri(
        name=request.user.email or request.user.username,
        issuer_name=f'{getattr(settings, "SITE_NAME", "HomeKonet")} Superadmin',
    )
    img = qrcode.make(otpauth_url)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    qr_b64 = base64.b64encode(buf.getvalue()).decode('ascii')

    return Response({
        'secret': secret,
        'otpauth_url': otpauth_url,
        'qr_code_base64': qr_b64,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mfa_confirm(request):
    if not is_superadmin_staff(request.user):
        return Response({'error': 'Superadmin access required'}, status=status.HTTP_403_FORBIDDEN)

    code = str(request.data.get('code', '')).strip()
    device = MFADevice.objects.filter(user=request.user).first()
    if not device:
        return Response({'error': 'Call mfa/setup/ first.'}, status=status.HTTP_400_BAD_REQUEST)
    if device.confirmed:
        return Response({'error': 'MFA is already enabled.'}, status=status.HTTP_400_BAD_REQUEST)

    if not pyotp.TOTP(device.secret).verify(code, valid_window=1):
        return Response({'error': 'Invalid code.'}, status=status.HTTP_400_BAD_REQUEST)

    plain_backup_codes = [secrets.token_hex(4) for _ in range(BACKUP_CODE_COUNT)]
    device.backup_codes = [make_password(c) for c in plain_backup_codes]
    device.confirmed = True
    device.confirmed_at = timezone.now()
    device.save(update_fields=['backup_codes', 'confirmed', 'confirmed_at'])

    log_admin_action(request, 'mfa.enable', target=request.user)
    return Response({'backup_codes': plain_backup_codes})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mfa_disable(request):
    device = MFADevice.objects.filter(user=request.user).first()
    if not device or not device.confirmed:
        return Response({'error': 'MFA is not enabled.'}, status=status.HTTP_400_BAD_REQUEST)

    code = str(request.data.get('code', '')).strip()
    if not _verify_code_or_backup(device, code):
        return Response({'error': 'Invalid code.'}, status=status.HTTP_400_BAD_REQUEST)

    device.delete()
    log_admin_action(request, 'mfa.disable', target=request.user)
    return Response({'message': 'MFA disabled.'})


def _verify_code_or_backup(device: MFADevice, code: str) -> bool:
    if pyotp.TOTP(device.secret).verify(code, valid_window=1):
        return True
    for hashed in device.backup_codes:
        if check_password(code, hashed):
            device.backup_codes = [h for h in device.backup_codes if h != hashed]
            device.save(update_fields=['backup_codes'])
            return True
    return False


# ── MFA step-up during login ─────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([MFAVerifyLoginRateThrottle])
def mfa_verify_login(request):
    """Completes login for an account with a confirmed MFA device. Called
    with the short-lived mfa_token issued by authapp.login_view in place of
    real tokens."""
    mfa_token = request.data.get('mfa_token', '')
    code = str(request.data.get('code', '')).strip()
    if not mfa_token or not code:
        return Response({'error': 'mfa_token and code are required'}, status=status.HTTP_400_BAD_REQUEST)

    signer = TimestampSigner(salt=MFA_LOGIN_SALT)
    try:
        user_id = signer.unsign(mfa_token, max_age=MFA_TOKEN_MAX_AGE)
    except SignatureExpired:
        return Response({'error': 'This code has expired. Please log in again.'}, status=status.HTTP_401_UNAUTHORIZED)
    except BadSignature:
        return Response({'error': 'Invalid session.'}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'Invalid session.'}, status=status.HTTP_401_UNAUTHORIZED)

    device = MFADevice.objects.filter(user=user, confirmed=True).first()
    if not device:
        return Response({'error': 'MFA is not enabled on this account.'}, status=status.HTTP_400_BAD_REQUEST)

    if not _verify_code_or_backup(device, code):
        return Response({'error': 'Invalid code.'}, status=status.HTTP_400_BAD_REQUEST)

    # Same token-issuing shape as authapp.views.login_view
    from authapp.serializers import UserSerializer
    from authapp.views import _set_refresh_cookie
    from realestate_backend.app_logging import log_activity
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    access_token = str(refresh.access_token)
    log_activity(request, 'user_login', user=user)
    response = Response({'access': access_token, 'user': UserSerializer(user).data})
    _set_refresh_cookie(response, refresh)
    return response


# ── Audit log ─────────────────────────────────────────────────────────────

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def audit_log_list(request):
    from rbac.permissions import has_any_permission
    if not (is_full_admin(request.user) or has_any_permission(request.user, 'audit_log')):
        return Response({'error': 'Full admin access required'}, status=status.HTTP_403_FORBIDDEN)

    qs = AdminAuditLog.objects.select_related('actor').all()

    action = request.query_params.get('action')
    if action:
        qs = qs.filter(action__icontains=action)
    target_type = request.query_params.get('target_type')
    if target_type:
        qs = qs.filter(target_type=target_type)
    actor_id = request.query_params.get('actor')
    if actor_id:
        qs = qs.filter(actor_id=actor_id)
    date_from = request.query_params.get('date_from')
    if date_from:
        qs = qs.filter(created_at__gte=date_from)
    date_to = request.query_params.get('date_to')
    if date_to:
        qs = qs.filter(created_at__lte=date_to)

    try:
        page = max(1, int(request.query_params.get('page', 1)))
    except ValueError:
        page = 1
    page_size = 50
    start = (page - 1) * page_size
    total = qs.count()
    items = qs[start:start + page_size]

    return Response({
        'count': total,
        'page': page,
        'page_size': page_size,
        'results': AdminAuditLogSerializer(items, many=True).data,
    })


# ── Impersonation ────────────────────────────────────────────────────────────

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def impersonate_start(request, user_id):
    """Full-admin only: issue a short-lived, non-refreshable access token for
    the target user so the admin can see the app exactly as they do. Never
    touches the admin's own refresh cookie."""
    from rbac.permissions import has_any_permission
    if not (is_full_admin(request.user) or has_any_permission(request.user, 'users.impersonation')):
        return Response({'error': 'Full admin access required'}, status=status.HTTP_403_FORBIDDEN)

    try:
        target = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    if target.pk == request.user.pk:
        return Response({'error': "You can't impersonate yourself."}, status=status.HTTP_400_BAD_REQUEST)
    if is_full_admin(target):
        return Response({'error': 'Cannot impersonate another admin.'}, status=status.HTTP_400_BAD_REQUEST)

    reason = str(request.data.get('reason', '')).strip()
    if not reason:
        return Response({'error': 'A reason is required to start an impersonation session.'}, status=status.HTTP_400_BAD_REQUEST)

    session = ImpersonationSession.objects.create(
        admin=request.user, target=target, reason=reason,
        ip_address=get_client_ip(request),
    )
    log_admin_action(
        request, 'impersonation.start', target=target, reason=reason,
        session_id=session.pk,
    )

    token = AccessToken.for_user(target)
    token['imp_by'] = request.user.pk
    token['imp_session'] = session.pk

    from authapp.serializers import UserSerializer
    return Response({
        'access': str(token),
        'user': UserSerializer(target).data,
        'session_id': session.pk,
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def impersonate_stop(request):
    """Only the admin who started the session, the impersonated target (the
    front-end always calls this with the impersonation-issued token, so
    that's the normal case), a full admin, or a users.impersonation grant may
    end it — previously any authenticated user could pass an arbitrary
    session_id and terminate someone else's live impersonation session."""
    from rbac.permissions import has_any_permission
    session_id = request.data.get('session_id')
    session = ImpersonationSession.objects.filter(pk=session_id, ended_at__isnull=True).first()
    if session and not (
        request.user.pk in (session.admin_id, session.target_id)
        or is_full_admin(request.user) or has_any_permission(request.user, 'users.impersonation')
    ):
        return Response({'error': 'You are not authorized to end this impersonation session.'}, status=status.HTTP_403_FORBIDDEN)
    if session:
        session.ended_at = timezone.now()
        session.save(update_fields=['ended_at'])
        log_admin_action(
            request, 'impersonation.end', target=session.target,
            session_id=session.pk,
            duration_seconds=(session.ended_at - session.started_at).total_seconds(),
        )
    return Response({'message': 'Impersonation ended.'})
