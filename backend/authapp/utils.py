from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.conf import settings
import uuid


def send_verification_email(user):
    token = str(uuid.uuid4())
    user.email_verification_token = token
    user.save()

    # Development: token is printed to the terminal (EMAIL_BACKEND = console)
    # In production, switch EMAIL_BACKEND to smtp and uncomment the send_mail block below.
    print(f"\n=== EMAIL VERIFICATION TOKEN FOR {user.username} ===")
    print(f"Token: {token}")
    print(f"POST /api/auth/verify-email/  body: {{\"token\": \"{token}\"}}")
    print("=" * 55)

    """
    subject = "Verify your Email Address"
    verification_url = f"http://{settings.LOCAL_DOMAIN}/verify-email?token={token}"
    html_message = render_to_string("auth/verification_email.html", {
        "user": user,
        "verification_url": verification_url,
        "site_name": settings.SITE_NAME,
    })
    send_mail(subject, strip_tags(html_message), settings.DEFAULT_FROM_EMAIL,
              [user.email], html_message=html_message)
    """


def send_password_reset_email(user):
    token = str(uuid.uuid4())
    user.password_reset_token = token
    user.save()

    print(f"\n=== PASSWORD RESET TOKEN FOR {user.username} ===")
    print(f"Token: {token}")
    print(f"POST /api/auth/password-reset-confirm/  body: {{\"token\": \"{token}\", \"password\": \"...\", \"password2\": \"...\"}}")
    print("=" * 55)

    """
    subject = "Reset your Password"
    reset_url = f"http://{settings.LOCAL_DOMAIN}/reset-password?token={token}"
    html_message = render_to_string("auth/password_reset_email.html", {
        "user": user,
        "reset_url": reset_url,
        "site_name": settings.SITE_NAME,
    })
    send_mail(subject, strip_tags(html_message), settings.DEFAULT_FROM_EMAIL,
              [user.email], html_message=html_message)
    """
