"""
Celery tasks for the notifications app.

send_notification_email
-----------------------
Receives a notification ID, looks up the Notification record, renders the
matching HTML email template, and delivers the message via Django's email
backend.

Retry strategy: up to 3 attempts with a 60-second delay between them.
In development (CELERY_TASK_ALWAYS_EAGER=True) the task runs synchronously
inside the Django request so you see errors immediately.
"""
import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string, TemplateDoesNotExist

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_notification_email(self, notification_id: int):
    """
    Deliver an email for the given Notification pk.

    Template resolution order:
      1. emails/notifications/<notification_type>.html   (specific)
      2. emails/notifications/generic.html               (fallback)
    """
    from .models import Notification  # local import avoids circular imports at module load

    try:
        notification = Notification.objects.select_related('user').get(pk=notification_id)
    except Notification.DoesNotExist:
        logger.warning('send_notification_email: Notification %s not found', notification_id)
        return

    user = notification.user
    if not user.email:
        logger.info('send_notification_email: user %s has no email address, skipping', user.pk)
        return

    context = {
        'user':         user,
        'notification': notification,
        'data':         notification.data,
        'site_name':    getattr(settings, 'SITE_NAME', 'Real Estate Platform'),
        'site_url':     getattr(settings, 'LOCAL_DOMAIN', 'localhost:8000'),
    }

    # Try the specific template first, fall back to the generic one
    specific_template = f'emails/notifications/{notification.notification_type}.html'
    generic_template  = 'emails/notifications/generic.html'

    try:
        html_content = render_to_string(specific_template, context)
    except TemplateDoesNotExist:
        try:
            html_content = render_to_string(generic_template, context)
        except TemplateDoesNotExist:
            logger.error('send_notification_email: no template found for %s', notification.notification_type)
            html_content = f'<p>{notification.message}</p>'

    from_email = settings.DEFAULT_FROM_EMAIL or 'noreply@realestate.com'

    try:
        email = EmailMultiAlternatives(
            subject=notification.title,
            body=notification.message,   # plain-text fallback
            from_email=from_email,
            to=[user.email],
        )
        email.attach_alternative(html_content, 'text/html')
        email.send()

        notification.email_sent = True
        notification.save(update_fields=['email_sent'])
        logger.info(
            'Notification email sent: id=%s type=%s to=%s',
            notification_id, notification.notification_type, user.email,
        )

    except Exception as exc:
        logger.error('Failed to send notification email id=%s: %s', notification_id, exc)
        raise self.retry(exc=exc)
