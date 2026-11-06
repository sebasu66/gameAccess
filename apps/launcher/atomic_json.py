"""Shared by every module: write a JSON file so a crash never leaves it half written."""
from __future__ import annotations
import json
import os
from pathlib import Path


def write_json(path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)
