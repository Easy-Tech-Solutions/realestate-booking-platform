from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.db import models

from .role import Role


class User(AbstractUser):
    email = models.EmailField(unique=True)
    phone_number = models.CharField(max_length=32, blank=True)
    is_email_verified = models.BooleanField(default=False)
    is_phone_verified = models.BooleanField(default=False)

    roles = models.ManyToManyField(Role, related_name="users", blank=True)

    REQUIRED_FIELDS = ["email"]

    def __str__(self) -> str:  # pragma: no cover
        return self.username or self.email
from __future__ import annotations

from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    email = models.EmailField(unique=True)
    phone_number = models.CharField(max_length=32, blank=True)
    is_email_verified = models.BooleanField(default=False)
    is_phone_verified = models.BooleanField(default=False)

    roles = models.ManyToManyField("accounts.Role", related_name="users", blank=True)

    REQUIRED_FIELDS = ["email"]

    def __str__(self) -> str:  # pragma: no cover
        return self.username or self.email
