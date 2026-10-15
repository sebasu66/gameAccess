"""Content of the client's "Activar premium" screen.

The text, plans and ways to pay live in ``premium_content.json`` so they can be
changed on the server without shipping a new client. The client draws this data
with its own components and only opens links on its own allow-list.

Public on purpose: free users must be able to read it without a key.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Request, Response

router = APIRouter()
CONTENT_FILE = Path(__file__).with_name("premium_content.json")
_COUNTRY = re.compile(r"^[A-Za-z]{2}$")


def load_content() -> dict:
    with CONTENT_FILE.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def detect_region(request: Request, regions: dict) -> str:
    """Best guess of the payment region: CDN country header first, then the client's hint."""
    for header in ("cf-ipcountry", "x-vercel-ip-country", "x-country-code"):
        value = (request.headers.get(header) or "").strip()
        if _COUNTRY.match(value) and value.upper() in regions:
            return value.upper()
    hint = (request.query_params.get("hint") or "").strip().upper()
    if _COUNTRY.match(hint) and hint in regions:
        return hint
    return "default"


@router.get("/premium/content")
def premium_content(request: Request, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    content = load_content()
    return {**content, "region": detect_region(request, content.get("regions", {}))}
