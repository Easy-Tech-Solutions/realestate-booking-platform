from django.core.mail import send_mail


def send_email_otp(to_email: str, code: str) -> None:
    subject = "Your verification code"
    body = f"Your OTP code is: {code}"
    send_mail(subject, body, None, [to_email], fail_silently=True)
