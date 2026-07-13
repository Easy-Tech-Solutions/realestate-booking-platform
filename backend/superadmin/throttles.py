from rest_framework.throttling import AnonRateThrottle


class MFAVerifyLoginRateThrottle(AnonRateThrottle):
    """A 6-digit TOTP code is brute-forceable in ~1M requests; keep this tight."""
    scope = "mfa_verify_login"
