from celery import shared_task
from .services.email_service import send_notification_email


@shared_task
def send_email_task(subject: str, message: str, recipient: str) -> None:
    send_notification_email(subject, message, recipient)
