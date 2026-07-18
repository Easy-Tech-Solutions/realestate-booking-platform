"""
Loaded into the celery-ai worker via `celery -I aiscoring.worker_warmup`.
Connects to worker_init so the model is loaded inside the worker process
before it starts accepting tasks — eliminating the cold-start on first message.
"""
from celery.signals import worker_ready


@worker_ready.connect
def _warmup(sender, **kwargs):
    try:
        from aiscoring.model_service import warmup
        warmup()
    except Exception:
        pass
