from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LoginRateThrottle(AnonRateThrottle):
    scope = "login"


class RegisterRateThrottle(AnonRateThrottle):
    scope = "register"


class PasswordResetRateThrottle(AnonRateThrottle):
    scope = "password_reset"


class VerifyEmailRateThrottle(AnonRateThrottle):
    scope = "verify_email"


class PhoneChangeRateThrottle(UserRateThrottle):
    """
    Limits how often an authenticated user can hit any phone-change endpoint.
    Uses UserRateThrottle (keyed by user ID) so the limit tracks the account,
    not the IP — prevents circumvention via VPN / shared IPs.
    Rate: 5 attempts per hour (set in DEFAULT_THROTTLE_RATES in settings.py).
    """
    scope = "phone_change"
