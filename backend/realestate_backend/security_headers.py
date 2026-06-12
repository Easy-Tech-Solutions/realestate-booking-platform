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
        response.setdefault('Content-Security-Policy', self.CSP)
        response.setdefault('Permissions-Policy', self.PERMISSIONS_POLICY)
        return response
