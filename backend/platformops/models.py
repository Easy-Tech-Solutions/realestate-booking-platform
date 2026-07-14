from django.conf import settings
from django.db import models


class FeatureFlag(models.Model):
    """A platform-wide on/off switch, checked at request time via
    `is_feature_enabled(key)`. Three keys are wired to real enforcement
    today: 'maintenance_mode' (read-only API for non-staff, see
    middleware.py), 'new_registrations_enabled' (gates
    authapp.register/google_login), and 'ai_scoring_enabled' (gates the local
    LLM scoring tasks in aiscoring.tasks — default off so a fresh deploy never
    loads the ~3GB model until an admin opts in). Any other key can be
    created here but won't do anything until something in the codebase
    actually checks it — this is a switch registry, not magic."""

    key = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    is_enabled = models.BooleanField(default=False)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='feature_flags_updated',
    )
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['key']

    def __str__(self):
        return f'{self.key} ({"on" if self.is_enabled else "off"})'


class TaskHeartbeat(models.Model):
    """One row per recurring Celery task, updated at the end of every run.
    Lets the platform health dashboard show 'last ran at X, succeeded' for
    the handful of scheduled jobs this platform actually has, without adding
    a heavier dependency like django-celery-beat's result backend."""

    task_name = models.CharField(max_length=200, unique=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    last_success = models.BooleanField(null=True)
    last_error = models.TextField(blank=True)
    run_count = models.PositiveIntegerField(default=0)

    def __str__(self):
        return f'{self.task_name} — last run {self.last_run_at}'

    @classmethod
    def record(cls, task_name, success=True, error=''):
        obj, _ = cls.objects.get_or_create(task_name=task_name)
        from django.utils import timezone
        obj.last_run_at = timezone.now()
        obj.last_success = success
        obj.last_error = error if not success else ''
        obj.run_count = models.F('run_count') + 1
        obj.save(update_fields=['last_run_at', 'last_success', 'last_error', 'run_count'])
