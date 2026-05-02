"""
SuspensionMiddleware
====================
Runs on every incoming request. If the authenticated user has an active
suspension their request is short-circuited with a 403 JSON response that
includes the suspension reason and expiry information.

How JWT users are handled
-------------------------
Django's AuthenticationMiddleware only populates request.user for session-based
auth. For JWT requests the user is resolved inside DRF's view layer, which runs
*after* middleware. To catch JWT users here we manually decode the Authorization
header using SimpleJWT's AccessToken — if it's valid we get the user_id and can
query for an active suspension before DRF ever runs.

If the token is invalid/expired we leave the request alone; DRF's authentication
backend will reject it with the correct 401 response.

Exemptions
----------
- /admin/*   — admins must be able to log in and manage suspensions
- Staff / superusers — they are never blocked by this middleware
"""

import json
import logging

from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone

logger = logging.getLogger(__name__)


class SuspensionMiddleware:

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Always let the admin panel through
        if request.path.startswith('/admin/'):
            return self.get_response(request)

        user = self._resolve_user(request)

        if user is not None and not user.is_staff and not user.is_superuser:
            suspension = self._get_active_suspension(user)
            if suspension:
                return JsonResponse(self._build_response(suspension), status=403)

        return self.get_response(request)


    # Private helpers

    def _resolve_user(self, request):
        """
        Return the User for this request, or None.

        Tries session-auth first (fast path), then falls back to manually
        decoding the JWT Bearer token.
        """
        # Session / basic auth — Django already set request.user
        if hasattr(request, 'user') and request.user.is_authenticated:
            return request.user

        # JWT Bearer token
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            return None

        raw_token = auth_header.split(' ', 1)[1]
        try:
            from rest_framework_simplejwt.tokens import AccessToken
            from django.contrib.auth import get_user_model

            validated = AccessToken(raw_token)
            user_id   = validated.get('user_id')
            if user_id is None:
                return None

            User = get_user_model()
            return User.objects.get(pk=user_id)

        except Exception:
            # Expired, invalid, or user not found — let DRF handle it
            return None

    def _get_active_suspension(self, user):
        """
        Return the first active Suspension for this user, or None.

        A suspension is active when:
          - status == 'active'
          - ends_at is null (indefinite/permanent) OR ends_at > now (not yet expired)

        Uses lazy evaluation: we don't rely on a background task having marked
        expired records — we filter by ends_at directly, so it's always accurate.
        """
        from .models import Suspension

        return (
            Suspension.objects
            .filter(user=user, status=Suspension.Status.ACTIVE)
            .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=timezone.now()))
            .select_related('issued_by')
            .first()
        )

    def _build_response(self, suspension):
        data = {
            'detail': 'Your account has been suspended.',
            'code': 'account_suspended',
            'reason': suspension.reason,
            'suspension_type': suspension.suspension_type,
            'started_at': suspension.started_at.isoformat(),
            'ends_at': suspension.ends_at.isoformat() if suspension.ends_at else None,
        }
        return data
