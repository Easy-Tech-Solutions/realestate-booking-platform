from rest_framework import serializers

from .registry import ModelConfig

_SERIALIZER_CACHE: dict[str, type[serializers.ModelSerializer]] = {}


def get_serializer_class(model_key: str, config: ModelConfig) -> type[serializers.ModelSerializer]:
    if config.serializer_class is not None:
        return config.serializer_class

    cached = _SERIALIZER_CACHE.get(model_key)
    if cached is not None:
        return cached

    meta = type('Meta', (), {
        'model': config.model,
        'fields': config.fields,
        'read_only_fields': config.read_only_fields,
    })
    built = type(f'{config.model.__name__}GenericSerializer', (serializers.ModelSerializer,), {'Meta': meta})
    _SERIALIZER_CACHE[model_key] = built
    return built
