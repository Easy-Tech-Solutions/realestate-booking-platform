import secrets
from datetime import timedelta

from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.utils import timezone
from django.conf import settings

TOKEN_BYTES = 32  # 256 bits of entropy (URL-safe base64 → ~43 chars)
EMAIL_VERIFICATION_EXPIRY_HOURS = 24
PASSWORD_RESET_EXPIRY_HOURS = 1


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


def send_password_reset_email(user):
    token = _generate_secure_token()
    user.password_reset_token = token
    user.password_reset_token_expires_at = timezone.now() + timedelta(hours=PASSWORD_RESET_EXPIRY_HOURS)
    user.save(update_fields=['password_reset_token', 'password_reset_token_expires_at'])

    subject = "Reset your Password"
    reset_url = f"https://{settings.LOCAL_DOMAIN}/reset-password?token={token}"
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
