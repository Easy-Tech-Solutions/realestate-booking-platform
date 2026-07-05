"""
Celery tasks for the bookings app — the two reservation timers.

Register both with Celery Beat (see CELERY_BEAT_SCHEDULE in settings.py):

    'expire-unconfirmed-reservations': {
        'task': 'bookings.tasks.expire_unconfirmed_reservations',
        'schedule': crontab(minute=0),  # hourly
    },
    'expire-unpaid-reservations': {
        'task': 'bookings.tasks.expire_unpaid_reservations',
        'schedule': crontab(minute=5),  # hourly
    },

Both are thin wrappers around bookings.services so the same logic is reachable
from a Django shell or management command.
"""
from celery import shared_task


@shared_task
def expire_unconfirmed_reservations():
    """Expire reservations the host never confirmed within the 7-day window."""
    from .services import expire_unconfirmed_reservations as _run
    return _run()


@shared_task
def expire_unpaid_reservations():
    """Expire host-confirmed reservations the guest never paid for (10-day window)."""
    from .services import expire_unpaid_reservations as _run
    return _run()
