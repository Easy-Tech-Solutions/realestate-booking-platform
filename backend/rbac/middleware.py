"""
BreakGlassAuditMiddleware
=========================
While a user holds an active BreakGlassSession, every request they make is
logged to AdminAuditLog with method/path/status/timing — a complete
request-level audit trail for the elevated window. This is NOT literal
keystroke capture (not achievable server-side without client-side
instrumentation this project doesn't have) — it's the honest, real
equivalent: nothing an elevated engineer does during the window goes
unlogged.

JWT users are resolved the same way suspensions.middleware.SuspensionMiddleware
and platformops.middleware.MaintenanceModeMiddleware do.
"""
import time


class BreakGlassAuditMiddleware:

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        start = time.monotonic()
        response = self.get_response(request)

        user = self._resolve_user(request)
        if user is not None:
            self._log_if_active(request, response, user, time.monotonic() - start)

        return response

    def _resolve_user(self, request):
        if hasattr(request, 'user') and request.user.is_authenticated:
            return request.user

        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            return None

        raw_token = auth_header.split(' ', 1)[1]
        try:
            from rest_framework_simplejwt.tokens import AccessToken
            from django.contrib.auth import get_user_model

            validated = AccessToken(raw_token)
            user_id = validated.get('user_id')
            if user_id is None:
                return None

            User = get_user_model()
            return User.objects.get(pk=user_id)
        except Exception:
            return None

    def _log_if_active(self, request, response, user, duration_seconds):
        from django.utils import timezone
        from .models import BreakGlassSession
        from superadmin.models import AdminAuditLog
        from superadmin.permissions import get_client_ip

        active = BreakGlassSession.objects.filter(
            user=user, revoked_at__isnull=True, expires_at__gt=timezone.now(),
        ).exists()
        if not active:
            return

        AdminAuditLog.objects.create(
            actor=user,
            action='break_glass.request',
            target_type='request',
            target_id='',
            target_repr=f'{request.method} {request.path}',
            reason='',
            ip_address=get_client_ip(request),
            user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
            metadata={
                'method': request.method,
                'path': request.path,
                'status_code': response.status_code,
                'duration_ms': round(duration_seconds * 1000, 1),
            },
        )
