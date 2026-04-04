"""
Celery application entry point.

How it works
------------
1.  We point Celery at our Django settings module so that tasks can import
    Django models and use the ORM.
2.  `app.config_from_object('django.conf:settings', namespace='CELERY')`
    means every setting that starts with CELERY_ in settings.py is forwarded
    to Celery automatically (broker URL, result backend, etc.).
3.  `autodiscover_tasks()` scans every app in INSTALLED_APPS for a tasks.py
    module and registers the tasks it finds.

Running the worker
------------------
Development (no broker — uses the 'always_eager' setting in dev):
    No extra process needed.

Production (Redis broker):
    celery -A realestate_backend worker --loglevel=info
    celery -A realestate_backend beat   --loglevel=info   # for periodic tasks
"""
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'realestate_backend.settings')

app = Celery('realestate_backend')

# Pull CELERY_* settings from Django's settings.py
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks.py in every installed app
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f'Request: {self.request!r}')
