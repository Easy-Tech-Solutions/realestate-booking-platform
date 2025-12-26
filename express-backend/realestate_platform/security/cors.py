"""Central place for CORS configuration helpers."""
from __future__ import annotations

from typing import Iterable


def parse_origins(origins: str | None) -> list[str]:
    if not origins:
        return []
    return [o.strip() for o in origins.split(",") if o.strip()]
