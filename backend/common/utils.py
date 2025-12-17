from __future__ import annotations

import uuid


def generate_code(length: int = 6) -> str:
    return uuid.uuid4().hex[:length].upper()
