"""
Self-service two-factor authentication for regular accounts — a parallel,
unprivileged counterpart to superadmin.views' staff-only MFA endpoints.
Both share the same MFADevice model (see superadmin.models.MFADevice); the
login step-up in authapp.views.login_view already checks for a confirmed
device on ANY user, so this was previously a dead end for non-staff users
with nowhere to actually turn MFA on.
"""
import base64
import io
import secrets

import pyotp
import qrcode
from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from realestate_backend.app_logging import log_activity
from superadmin.models import MFADevice

BACKUP_CODE_COUNT = 8


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def mfa_status(request):
    device = MFADevice.objects.filter(user=request.user).first()
    return Response({'mfa_enabled': bool(device and device.confirmed)})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mfa_setup(request):
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
        issuer_name=getattr(settings, 'SITE_NAME', 'HomeKonet'),
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

    log_activity(request, 'mfa_enabled')
    return Response({'backup_codes': plain_backup_codes})


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def mfa_disable(request):
    device = MFADevice.objects.filter(user=request.user).first()
    if not device or not device.confirmed:
        return Response({'error': 'MFA is not enabled.'}, status=status.HTTP_400_BAD_REQUEST)

    code = str(request.data.get('code', '')).strip()
    if not device.verify_code_or_backup(code):
        return Response({'error': 'Invalid code.'}, status=status.HTTP_400_BAD_REQUEST)

    device.delete()
    log_activity(request, 'mfa_disabled')
    return Response({'message': 'MFA disabled.'})
