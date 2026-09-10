from django.apps import AppConfig


class SuperadminConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "superadmin"
    verbose_name = "Superadmin"

    def ready(self):
        from .generic_admin import registrations  # noqa: F401 — populates REGISTRY as import side effect
