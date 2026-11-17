"""Admin security."""
from __future__ import annotations
import base64
import secrets
from fastapi import HTTPException, Request
from .admin_auth import admin_authenticated, admin_password

def _admin_browser_access(request: Request) -> None:
    if admin_authenticated(request):
        return
    configured = admin_password()
    challenge = {"WWW-Authenticate": 'Basic realm="GameAccess client errors"'}
    if not configured:
        raise HTTPException(503, "Client error viewer is not configured")
    authorization = request.headers.get("Authorization", "")
    if not authorization.startswith("Basic "):
        raise HTTPException(401, "Administrator access required", headers=challenge)
    try:
        decoded = base64.b64decode(authorization.removeprefix("Basic ").strip()).decode("utf-8")
        username, password = decoded.split(":", 1)
    except Exception as exc:
        raise HTTPException(401, "Administrator access required", headers=challenge) from exc
    if username != "admin" or not secrets.compare_digest(password, configured):
        raise HTTPException(401, "Administrator access required", headers=challenge)
