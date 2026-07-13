"""
MaintenanceModeMiddleware
=========================
When the 'maintenance_mode' FeatureFlag is enabled, blocks write requests
(POST/PUT/PATCH/DELETE) from non-staff users with a 503, while leaving GET
requests untouched. This is a read-only-mode switch, not a full site outage
banner — the frontend is static files served by nginx, entirely outside
Django's request cycle, so there's no way for a backend flag to intercept
page loads. Blocking writes at the API layer is the real, honest scope of
what a single Django backend can enforce here.

JWT users are resolved the same way suspensions.middleware.SuspensionMiddleware
does: Django's AuthenticationMiddleware only populates request.user for
session auth, so we manually decode the Bearer token to check staff status
before DRF's own authentication ever runs.
"""

from django.http import JsonResponse

SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')
ALWAYS_ALLOWED_PREFIXES = ('/api/health/', '/admin/', '/api/superadmin/', '/api/platform-ops/')


class MaintenanceModeMiddleware:

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method in SAFE_METHODS or request.path.startswith(ALWAYS_ALLOWED_PREFIXES):
            return self.get_response(request)

        from .utils import is_feature_enabled
        if not is_feature_enabled('maintenance_mode', default=False):
            return self.get_response(request)

        user = self._resolve_user(request)
        if user is not None and (user.is_staff or user.is_superuser):
            return self.get_response(request)

        return JsonResponse(
            {'detail': 'The platform is in read-only maintenance mode. Please try again shortly.', 'code': 'maintenance_mode'},
            status=503,
        )

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
