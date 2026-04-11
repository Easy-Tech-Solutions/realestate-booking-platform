from django.apps import AppConfig


class SuspensionsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'suspensions'

    def ready(self):
        import suspensions.signals  # noqa: F401  — registers all signal handlers
