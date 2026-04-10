# This makes `celery_app` available as `realestate_backend.celery_app`
# and, crucially, ensures the Celery app is loaded when Django starts,
# so the @shared_task decorator works in all apps.
from .celery import app as celery_app  # noqa: F401

__all__ = ['celery_app']
