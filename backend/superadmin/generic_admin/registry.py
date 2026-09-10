"""
A whitelist-only registry of models the generic admin CRUD endpoints may
touch. `model_key` (attacker-controlled URL input) is resolved ONLY via the
REGISTRY dict below — never via `apps.get_model()` on user input — so every
exposed model is a deliberate, reviewed opt-in rather than something
discoverable by guessing a model/app name.
"""
from dataclasses import dataclass, field

from django.db import models
from django.http import Http404
from rest_framework import serializers

_SENSITIVE_SUBSTRINGS = ('secret', 'password', 'token', 'api_key', 'private_key')


@dataclass(frozen=True)
class ModelConfig:
    model: type[models.Model]
    resource: str                                   # RBAC resource key (see rbac.resources.RESOURCE_TREE)
    audit_label: str                                 # log_admin_action prefix, e.g. 'currency' -> 'currency.create'
    fields: list[str]                                # explicit whitelist — never '__all__'
    read_only_fields: list[str] = field(default_factory=lambda: ['id'])
    search_fields: list[str] = field(default_factory=list)      # icontains OR
    filterable_fields: list[str] = field(default_factory=list)  # exact ?field=value
    ordering_fields: list[str] = field(default_factory=list)
    default_ordering: str = '-id'
    read_only: bool = False                          # blocks create/update/delete when True
    serializer_class: type[serializers.ModelSerializer] | None = None  # escape hatch
    allow_sensitive_field_names: bool = False        # must be explicitly opted into per-model


REGISTRY: dict[str, ModelConfig] = {}


def register(model_key: str, config: ModelConfig) -> None:
    if not config.allow_sensitive_field_names:
        for f in config.fields:
            if any(s in f.lower() for s in _SENSITIVE_SUBSTRINGS):
                raise ValueError(
                    f"generic_admin.register('{model_key}'): field '{f}' looks sensitive. "
                    "Pass allow_sensitive_field_names=True only after explicit review."
                )
    REGISTRY[model_key] = config


def get_config(model_key: str) -> ModelConfig:
    config = REGISTRY.get(model_key)
    if config is None:
        raise Http404(f'"{model_key}" is not a registered generic-admin model.')
    return config
