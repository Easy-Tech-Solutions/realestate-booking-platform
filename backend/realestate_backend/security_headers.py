from django.conf import settings


class SecurityHeadersMiddleware:
    """
    Adds Content-Security-Policy and Permissions-Policy headers that
    Django's built-in SecurityMiddleware does not cover.

    CSP allows 'self' + Stripe JS so the Django admin and any embedded
    Stripe.js checkout components work correctly. object-src and
    frame-ancestors are locked to 'none'/'none' to block plugin injection
    and clickjacking independently of X-Frame-Options.
    """

    CSP = (
        "default-src 'self'; "
        "script-src 'self' https://js.stripe.com; "
        "frame-src 'self' https://js.stripe.com; "
        "img-src 'self' data: https: blob:; "
        "connect-src 'self' https://api.stripe.com wss:; "
        "font-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'"
    )

    # The Unfold admin is built on Alpine.js, which evaluates its directive
    # expressions with new Function() and therefore needs 'unsafe-eval'. Add it
    # ONLY for admin pages (see __call__) so the public API/app keep the strict
    # policy above. The admin is frame-ancestors 'none', so it isn't embeddable.
    CSP_ADMIN = CSP.replace(
        "script-src 'self' https://js.stripe.com;",
        "script-src 'self' 'unsafe-eval' https://js.stripe.com;",
    )

    PERMISSIONS_POLICY = (
        "camera=(), "
        "microphone=(), "
        "geolocation=(self), "
        "payment=(self \"https://js.stripe.com\"), "
        "usb=(), "
        "interest-cohort=()"
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        admin_prefix = '/' + getattr(settings, 'ADMIN_URL', 'admin/')
        csp = self.CSP_ADMIN if request.path.startswith(admin_prefix) else self.CSP
        response.setdefault('Content-Security-Policy', csp)
        response.setdefault('Permissions-Policy', self.PERMISSIONS_POLICY)
        return response
