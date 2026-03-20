from __future__ import annotations

import os
from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "realestate_platform.settings.production")

app = Celery("realestate_platform")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
