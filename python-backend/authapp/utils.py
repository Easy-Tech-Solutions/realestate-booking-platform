from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils.html import strip_tags
from django.conf import settings
import uuid

def send_verification_email(user):
    token = str(uuid.uuid4())
    user.email_verification_token = token
    user.save()

    # For testing: print token to console instead of sending email
    print(f"\n=== EMAIL VERIFICATION TOKEN FOR {user.username} ===")
    print(f"Token: {token}")
    print(f"Use this token in Postman at: POST /api/auth/verify-email/")
    print("=" * 50)

    # Uncomment below for production email sending
    """
    subject = "Verify your Email Address"
    verification_url = f"http://{settings.LOCAL_DOMAIN}/api/auth/verify-email/?token={token}"

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
    )
    """