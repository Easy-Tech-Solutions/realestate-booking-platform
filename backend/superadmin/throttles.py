from rest_framework.throttling import AnonRateThrottle


class MFAVerifyLoginRateThrottle(AnonRateThrottle):
    """A 6-digit TOTP code is brute-forceable in ~1M requests; keep this tight."""
    scope = "mfa_verify_login"


class MFAEmailCodeRateThrottle(AnonRateThrottle):
    """Sending an email costs real money/deliverability reputation and is a
    spam vector against the account holder's inbox — keep this tighter than
    verify attempts."""
    scope = "mfa_email_code"
