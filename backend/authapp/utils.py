import random
import secrets
from datetime import timedelta

from django.contrib.auth.hashers import check_password, make_password
from django.core.cache import cache
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.utils import timezone
from django.conf import settings

TOKEN_BYTES = 32  # 256 bits of entropy (URL-safe base64 → ~43 chars)
EMAIL_VERIFICATION_EXPIRY_HOURS = 24
PASSWORD_RESET_EXPIRY_HOURS = 1

# MFA login step-up fallback for admins who've lost their authenticator
# device — a one-time code emailed to the account's registered address.
# Recovery/backup codes already cover this case; this is the friendlier
# alternative so an admin doesn't have to burn one of a limited set.
MFA_EMAIL_CODE_TTL_SECONDS = 600  # 10 minutes
_MFA_EMAIL_CODE_CACHE_KEY = 'mfa_email_code:{user_id}'


def _generate_secure_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def send_verification_email(user):
    token = _generate_secure_token()
    user.email_verification_token = token
    user.email_verification_token_expires_at = timezone.now() + timedelta(hours=EMAIL_VERIFICATION_EXPIRY_HOURS)
    user.save(update_fields=['email_verification_token', 'email_verification_token_expires_at'])

    subject = "Verify your Email Address"
    verification_url = f"https://{settings.LOCAL_DOMAIN}/api/auth/verify-email/?token={token}"
    html_message = render_to_string("auth/verification_email.html", {
        "user": user,
        "verification_url": verification_url,
        "site_name": settings.SITE_NAME,
    })
    if settings.DEBUG or settings.EMAIL_BACKEND.endswith("console.EmailBackend"):
        print(f"\n=== EMAIL VERIFICATION TOKEN FOR {user.username} ===")
        print(f"Token: {token}")
        print(f"POST /api/auth/verify-email/  body: {{\"token\": \"{token}\"}}")
        print(f"Expires in {EMAIL_VERIFICATION_EXPIRY_HOURS}h")
        print("=" * 55)
    send_mail(subject, strip_tags(html_message), settings.DEFAULT_FROM_EMAIL,
              [user.email], html_message=html_message)


def send_mfa_email_code(user):
    """Generate and email a 6-digit one-time code as an MFA login step-up
    fallback. Stored hashed in cache (Redis-backed), never in the DB —
    short-lived and single-use. Consumed by verify_mfa_email_code(), which
    superadmin.views.mfa_verify_login falls back to when the submitted code
    doesn't match a TOTP or backup code."""
    code = f'{random.SystemRandom().randrange(0, 1_000_000):06d}'
    cache.set(
        _MFA_EMAIL_CODE_CACHE_KEY.format(user_id=user.id),
        make_password(code),
        timeout=MFA_EMAIL_CODE_TTL_SECONDS,
    )

    subject = "Your verification code"
    html_message = render_to_string("auth/mfa_email_code.html", {
        "user": user,
        "code": code,
        "site_name": settings.SITE_NAME,
        "expiry_minutes": MFA_EMAIL_CODE_TTL_SECONDS // 60,
    })
    if settings.DEBUG or settings.EMAIL_BACKEND.endswith("console.EmailBackend"):
        print(f"\n=== MFA EMAIL CODE FOR {user.username} ===")
        print(f"Code: {code}")
        print(f"Expires in {MFA_EMAIL_CODE_TTL_SECONDS // 60} minutes")
        print("=" * 55)
    send_mail(subject, strip_tags(html_message), settings.DEFAULT_FROM_EMAIL,
              [user.email], html_message=html_message)


def verify_mfa_email_code(user, code: str) -> bool:
    key = _MFA_EMAIL_CODE_CACHE_KEY.format(user_id=user.id)
    hashed = cache.get(key)
    if not hashed or not code or not check_password(code, hashed):
        return False
    cache.delete(key)
    return True


def send_password_reset_email(user):
    token = _generate_secure_token()
    user.password_reset_token = token
    user.password_reset_token_expires_at = timezone.now() + timedelta(hours=PASSWORD_RESET_EXPIRY_HOURS)
    user.save(update_fields=['password_reset_token', 'password_reset_token_expires_at'])

    subject = "Reset your Password"
    frontend = getattr(settings, "FRONTEND_ORIGIN", "") or f"https://{settings.LOCAL_DOMAIN}"
    reset_url = f"{frontend.rstrip('/')}/reset-password?token={token}"
    html_message = render_to_string("auth/password_reset_email.html", {
        "user": user,
        "reset_url": reset_url,
        "site_name": settings.SITE_NAME,
    })
    if settings.DEBUG or settings.EMAIL_BACKEND.endswith("console.EmailBackend"):
        print(f"\n=== PASSWORD RESET TOKEN FOR {user.username} ===")
        print(f"Token: {token}")
        print(f"POST /api/auth/password-reset-confirm/  body: {{\"token\": \"{token}\", \"password\": \"...\", \"password2\": \"...\"}}")
        print(f"Expires in {PASSWORD_RESET_EXPIRY_HOURS}h")
        print("=" * 55)
    send_mail(subject, strip_tags(html_message), settings.DEFAULT_FROM_EMAIL,
              [user.email], html_message=html_message)
