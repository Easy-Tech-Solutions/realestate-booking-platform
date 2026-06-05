class SecurityHeadersMiddleware:
    """
    Adds Content-Security-Policy and Permissions-Policy headers that
    Django's built-in SecurityMiddleware does not cover.
    """

    CSP = (
        "default-src 'none'; "
        "frame-ancestors 'none'; "
        "base-uri 'self'"
    )

    PERMISSIONS_POLICY = (
        "camera=(), microphone=(), geolocation=(), "
        "interest-cohort=(), payment=()"
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault('Content-Security-Policy', self.CSP)
        response.setdefault('Permissions-Policy', self.PERMISSIONS_POLICY)
        return response
