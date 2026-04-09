"""
Celery tasks for the suspensions app.

expire_suspensions
------------------
Finds every ACTIVE suspension whose ends_at has passed and marks it EXPIRED.
Also sends a reinstatement notification to each affected user.

Schedule this task to run periodically (e.g. every hour) using Celery Beat:

    CELERY_BEAT_SCHEDULE = {
        'expire-suspensions': {
            'task': 'suspensions.tasks.expire_suspensions',
            'schedule': crontab(minute=0),  # top of every hour
        },
    }

Or call it manually from a management command / Django shell:

    from suspensions.tasks import expire_suspensions
    expire_suspensions()
"""

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task
def expire_suspensions():
    """
    Mark all naturally-expired suspensions as EXPIRED and notify users.
    Safe to run multiple times (idempotent).
    """
    from .models import Suspension
    from notifications.services import notify_account_reinstated

    now = timezone.now()
    expired = Suspension.objects.filter(
        status=Suspension.Status.ACTIVE,
        ends_at__lte=now,
    ).select_related('user')

    count = 0
    for suspension in expired:
        suspension.mark_expired()
        try:
            notify_account_reinstated(suspension)
        except Exception as exc:
            logger.warning(
                'expire_suspensions: could not notify user %s for suspension %s: %s',
                suspension.user_id, suspension.pk, exc,
            )
        count += 1

    logger.info('expire_suspensions: marked %d suspension(s) as expired', count)
    return count
