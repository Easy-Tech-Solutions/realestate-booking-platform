from django.db import models


class Role(models.Model):
    name = models.CharField(max_length=50, unique=True)
    description = models.CharField(max_length=255, blank=True)

    # Example flags for RBAC checks
    is_admin = models.BooleanField(default=False)
    is_owner = models.BooleanField(default=False)  # property owner/host
    is_user = models.BooleanField(default=True)

    def __str__(self) -> str:  # pragma: no cover
        return self.name
