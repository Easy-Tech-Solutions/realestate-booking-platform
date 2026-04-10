"""
Utilities for the phone-number change flow.

OTP generation
--------------
generate_otp()  →  random 6-digit string

Email OTP
---------
send_phone_change_email_otp(user, otp)
  Sends the email-step OTP to the user's registered email address.
  Development: prints to console (matches the pattern in authapp/utils.py).
  Production:  uncomment the send_mail block and set EMAIL_BACKEND to SMTP.

SMS OTP
-------
send_phone_change_sms_otp(phone_number, otp, network_provider)
  Sends the SMS-step OTP to the *new* phone number the user wants to link.
  Development: prints to console.
  Production:  uncomment the Twilio block and set TWILIO_* env vars.
               Africa's Talking is an alternative that covers Liberia well —
               swap in their SDK if preferred.
"""

import random
import string

from django.core.mail import send_mail
from django.conf import settings


def generate_otp(length=6):
    #Return a random numeric OTP string of `length` digits
    return ''.join(random.choices(string.digits, k=length))


# ── Email OTP ──────────────────────────────────────────────────────────────────

def send_phone_change_email_otp(user, otp):
    """
    Send the Step-2 email OTP to the user's registered email address.
    The OTP expires in 10 minutes (enforced in the view/model).
    """
    # Development: print to console for Postman / manual testing
    print(f"\n=== PHONE CHANGE EMAIL OTP FOR {user.username} ===")
    print(f"OTP: {otp}  (valid 10 minutes)")
    print(f"Submit at: POST /api/users/phone-change/verify-email/")
    print("=" * 52)

    # ── Production email ───────────────────────────────────────────────────────
    # Switch EMAIL_BACKEND to smtp.EmailBackend in settings.py, then uncomment:
    """
    subject = f"[{settings.SITE_NAME}] Verify your phone number change"
    message = (
        f"Hi {user.get_short_name() or user.username},\n\n"
        f"We received a request to change the mobile wallet number on your account.\n\n"
        f"Your verification code is:  {otp}\n\n"
        f"This code expires in 10 minutes.\n\n"
        f"If you did not request this change, please secure your account immediately "
        f"by resetting your password.\n\n"
        f"— The {settings.SITE_NAME} Team"
    )
    send_mail(
        subject,
        message,
        settings.DEFAULT_FROM_EMAIL,
        [user.email],
    )
    """


# ── SMS OTP ────────────────────────────────────────────────────────────────────

def send_phone_change_sms_otp(phone_number, otp, network_provider):
    """
    Send the Step-3 SMS OTP to `phone_number` (the *new* number being verified).

    `network_provider` is 'mtn' or 'orange' — useful for provider-specific
    SMS gateway routing if needed.

    Development: print to console.
    Production:  fill in Twilio credentials via environment variables and
                 uncomment the Twilio block below.
                 Alternatively swap Twilio for Africa's Talking, which has
                 strong coverage across Liberia's MTN and Orange networks.
    """
    network_label = 'MTN Mobile Money' if network_provider == 'mtn' else 'Orange Money'

    # Development: print to console for Postman / manual testing
    print(f"\n=== PHONE CHANGE SMS OTP ===")
    print(f"To: {phone_number}  ({network_label})")
    print(f"OTP: {otp}  (valid 10 minutes)")
    print(f"Submit at: POST /api/users/phone-change/verify-sms/")
    print("=" * 35)

    # ── Production SMS via Twilio ──────────────────────────────────────────────
    # pip install twilio
    # Set in .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
    #
    # from twilio.rest import Client
    # client = Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
    # client.messages.create(
    #     body=(
    #         f"[{settings.SITE_NAME}] Your phone number verification code is {otp}. "
    #         f"Valid for 10 minutes. Do not share this code."
    #     ),
    #     from_=settings.TWILIO_FROM_NUMBER,
    #     to=phone_number,
    # )

    # ── Production SMS via Africa's Talking (alternative) ─────────────────────
    # pip install africastalking
    # Set in .env: AT_USERNAME, AT_API_KEY
    #
    # import africastalking
    # africastalking.initialize(settings.AT_USERNAME, settings.AT_API_KEY)
    # sms = africastalking.SMS
    # sms.send(
    #     message=(
    #         f"[{settings.SITE_NAME}] Your verification code is {otp}. "
    #         f"Valid 10 min. Do not share."
    #     ),
    #     recipients=[phone_number],
    # )
