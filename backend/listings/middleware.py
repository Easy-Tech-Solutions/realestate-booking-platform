from django.utils import timezone
from .models import PropertyView

TRUSTED_PROXY_IPS: set[str] = set()

class ViewTrackingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if request.path.startswith('/api/listings/') and request.method == 'GET':
            try:
                path_parts = request.path.strip('/').split('/')

                if (len(path_parts) >= 3 and path_parts[2].isdigit() and len(path_parts) == 3):
                    listing_id = int(path_parts[2])

                    excluded_patterns = ['/images/', '/stats/', '/reviews/', '/favorites/', '/analytics/']
                    if not any(excluded in request.path for excluded in excluded_patterns):
                        PropertyView.objects.create(
                            listing_id=listing_id,
                            user=request.user if request.user.is_authenticated else None,
                            ip_address=self.get_client_ip(request),
                            user_agent=request.META.get('HTTP_USER_AGENT', '')[:255],
                        )

            except (ValueError, IndexError):
                pass

        return response

    def get_client_ip(self, request):
        remote_addr = request.META.get('REMOTE_ADDR', '')
        # Only trust X-Forwarded-For if the direct connection comes from a known proxy.
        if remote_addr in TRUSTED_PROXY_IPS:
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR', '')
            if x_forwarded_for:
                return x_forwarded_for.split(',')[0].strip()
        return remote_addr