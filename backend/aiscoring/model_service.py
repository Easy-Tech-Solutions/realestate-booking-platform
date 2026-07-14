"""
Lazy singleton loader for the local scoring model (Qwen2.5-3B-Instruct,
GGUF, CPU inference via llama-cpp-python).

Deliberately NOT imported at Django startup and NOT imported anywhere in the
request/response path — only aiscoring.tasks (Celery) ever calls get_model(),
so a 3GB model is loaded once per Celery worker process, never per web worker.
"""
import logging
import os
import threading

from django.conf import settings

logger = logging.getLogger(__name__)

_model = None
_lock = threading.Lock()


class ModelUnavailable(Exception):
    """Raised when the GGUF file isn't on disk yet (not downloaded) or fails to load."""


def get_model():
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        model_path = str(settings.AI_MODEL_PATH)
        if not os.path.exists(model_path):
            raise ModelUnavailable(
                f'AI model file not found at {model_path} — run '
                '`python manage.py download_ai_model` first.'
            )
        from llama_cpp import Llama
        logger.info('Loading local AI scoring model from %s', model_path)
        _model = Llama(
            model_path=model_path,
            n_ctx=settings.AI_MODEL_CONTEXT_SIZE,
            n_threads=os.cpu_count() or 4,
            verbose=False,
        )
        return _model
