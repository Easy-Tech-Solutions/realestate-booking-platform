from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.conf import settings
import uuid


def send_verification_email(user):
    token = str(uuid.uuid4())
    user.email_verification_token = token
    user.save()
    verification_url = f"{settings.FRONTEND_ORIGIN}/verify-email?token={token}"
    subject = f"Verify your email for {settings.SITE_NAME}"
    html_message = render_to_string("auth/verification_email.html", {
        "user": user,
        "verification_url": verification_url,
        "site_name": settings.SITE_NAME,
    })
    plain_message = strip_tags(html_message)

    send_mail(
        subject,
        plain_message,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        html_message=html_message,
        fail_silently=False,
    )

    if settings.DEBUG and settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend":
        print(f"\n=== EMAIL VERIFICATION LINK FOR {user.username} ===")
        print(f"Open in frontend: {verification_url}")
        print("=" * 55)


def send_password_reset_email(user):
    token = str(uuid.uuid4())
    user.password_reset_token = token
    user.save()
    reset_url = f"{settings.FRONTEND_ORIGIN}/reset-password?token={token}"
    subject = f"Reset your password for {settings.SITE_NAME}"
    html_message = render_to_string("auth/password_reset_email.html", {
        "user": user,
        "reset_url": reset_url,
        "site_name": settings.SITE_NAME,
    })
    plain_message = strip_tags(html_message)

    send_mail(
        subject,
        plain_message,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
        html_message=html_message,
        fail_silently=False,
    )

    if settings.DEBUG and settings.EMAIL_BACKEND == "django.core.mail.backends.console.EmailBackend":
        print(f"\n=== PASSWORD RESET LINK FOR {user.username} ===")
        print(f"Open in frontend: {reset_url}")
        print("=" * 55)
