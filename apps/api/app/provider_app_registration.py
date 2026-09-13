from __future__ import annotations


def placeholder_name(app_id: int) -> str:
    return f"Steam {int(app_id)}"


def is_placeholder_name(app_id: int, name: str) -> bool:
    return str(name).strip() == placeholder_name(app_id)
