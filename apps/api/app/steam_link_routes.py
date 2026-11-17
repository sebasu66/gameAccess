"""Linking a Steam account to Game Access with Steam's own sign-in page ("Sign in through Steam", OpenID 2.0).

The user signs in on steamcommunity.com, never in Game Access: no password, code or Steam token reaches us. Steam
only tells the server which account it is (its SteamID64), and the server checks that answer with Steam itself
(check_authentication) before believing it. The desktop app asks for a sign-in (`/steam/link/start`, which gives it a
one-time `state` and the address to open in the browser), and asks with that state for the result
(`/steam/link/result/{state}`), once. Nothing is stored: a state lives LINK_SECONDS in memory.

The account's library comes afterwards from `/steam/owned-games` (steam_owned_routes.py), as for any SteamID."""
from __future__ import annotations

import html
import os
import re
import secrets
import threading
import time
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

router = APIRouter(prefix="/steam/link", tags=["steam-link"])
STEAM_OPENID = "https://steamcommunity.com/openid/login"
OPENID_NS = "http://specs.openid.net/auth/2.0"
IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select"
CLAIMED_ID = re.compile(r"^https://steamcommunity\.com/openid/id/(7656119\d{10})$")
SUMMARIES_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
LINK_SECONDS = 10 * 60
STATE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")
STARTS_PER_HOUR = 20

_links: dict[str, dict[str, Any]] = {}
_starts: dict[str, list[float]] = {}
_lock = threading.Lock()


def public_base(request: Request) -> str:
    """The server's public address, as Steam shows it on its page ("Sign in to <address>")."""
    configured = (os.environ.get("GAMEACCESS_PUBLIC_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "").strip()
    return (configured or str(request.base_url)).rstrip("/")


def _forget_old(now: float) -> None:
    for state in [s for s, link in _links.items() if now - link["at"] > LINK_SECONDS]:
        _links.pop(state, None)


def _allow(address: str, now: float) -> bool:
    with _lock:
        recent = [t for t in _starts.get(address, []) if now - t < 3600]
        _starts[address] = recent
        if len(recent) >= STARTS_PER_HOUR:
            return False
        recent.append(now)
        return True


@router.post("/start")
def start(request: Request) -> dict:
    now = time.time()
    if not _allow(request.client.host if request.client else "", now):
        raise HTTPException(status_code=429, detail="too_many_requests")
    state = secrets.token_urlsafe(24)
    with _lock:
        _forget_old(now)
        _links[state] = {"at": now, "status": "pending"}
    base = public_base(request)
    return {"state": state, "url": f"{base}/steam/link/go/{state}", "expires_in": LINK_SECONDS}


def login_url(base: str, state: str) -> str:
    return_to = f"{base}/steam/link/callback?{urlencode({'state': state})}"
    return STEAM_OPENID + "?" + urlencode({
        "openid.ns": OPENID_NS, "openid.mode": "checkid_setup", "openid.return_to": return_to, "openid.realm": base,
        "openid.identity": IDENTIFIER_SELECT, "openid.claimed_id": IDENTIFIER_SELECT,
    })


@router.get("/go/{state}")
def go(state: str, request: Request):
    """The browser's first stop: on to Steam's sign-in page for this state."""
    with _lock:
        link = _links.get(state)
    if not STATE.match(state) or not link or link["status"] != "pending":
        return _page("Este enlace ya no sirve", "Volvé a Game Access y empezá la vinculación otra vez.", status=410)
    return RedirectResponse(login_url(public_base(request), state), status_code=302)


def verify(params: dict[str, str], expected_return: str, client: httpx.Client) -> str | None:
    """The SteamID64 Steam vouches for, or None. Steam itself confirms the signed answer (check_authentication)."""
    if params.get("openid.mode") != "id_res" or params.get("openid.op_endpoint") != STEAM_OPENID:
        return None
    if not str(params.get("openid.return_to", "")).startswith(expected_return):
        return None
    match = CLAIMED_ID.match(params.get("openid.claimed_id", ""))
    if not match or params.get("openid.identity") != params.get("openid.claimed_id"):
        return None
    response = client.post(STEAM_OPENID, data={**{k: v for k, v in params.items() if k.startswith("openid.")},
                                               "openid.mode": "check_authentication"})
    response.raise_for_status()
    return match.group(1) if "is_valid:true" in response.text else None


def persona(client: httpx.Client, steam_id: str) -> str:
    key = os.environ.get("STEAM_WEB_API_KEY", "").strip()
    if not key:
        return ""
    try:
        response = client.get(SUMMARIES_URL, params={"key": key, "steamids": steam_id})
        response.raise_for_status()
        players = (response.json().get("response") or {}).get("players") or []
        return str(players[0].get("personaname") or "") if players else ""
    except (httpx.HTTPError, ValueError, IndexError):
        return ""   # never echo the request URL: it carries the key


@router.get("/callback")
def callback(request: Request, state: str = ""):
    with _lock:
        link = _links.get(state)
    if not STATE.match(state or "") or not link or link["status"] != "pending":
        return _page("Este enlace ya no sirve", "Volvé a Game Access y empezá la vinculación otra vez.", status=410)
    params = {k: v for k, v in request.query_params.items() if k.startswith("openid.")}
    base = public_base(request)
    if params.get("openid.mode") == "cancel":
        with _lock:
            link.update(status="cancelled")
        return _page("Vinculación cancelada", "No se vinculó ninguna cuenta. Podés cerrar esta pestaña.")
    try:
        with httpx.Client(timeout=12.0, headers={"User-Agent": "gameAccess steam-link"}) as client:
            steam_id = verify(params, f"{base}/steam/link/callback", client)
            name = persona(client, steam_id) if steam_id else ""
    except httpx.HTTPError:
        steam_id, name = None, ""
    with _lock:
        if steam_id:
            link.update(status="done", steam_id=steam_id, persona=name)
        else:
            link.update(status="failed")
    if not steam_id:
        return _page("Steam no confirmó la cuenta", "Volvé a Game Access y probá otra vez.", status=400)
    return _page("Cuenta de Steam vinculada", f"{html.escape(name) or steam_id} ya está en Game Access. Podés cerrar esta pestaña y volver a la app.")


@router.get("/result/{state}")
def result(state: str) -> dict:
    """pending, done (with the account, said once), cancelled, failed or expired."""
    now = time.time()
    with _lock:
        _forget_old(now)
        link = _links.get(state) if STATE.match(state) else None
        if not link:
            return {"status": "expired"}
        if link["status"] in ("done", "cancelled", "failed"):
            _links.pop(state, None)
        return {k: v for k, v in link.items() if k != "at"}


def _page(title: str, text: str, status: int = 200) -> HTMLResponse:
    return HTMLResponse(status_code=status, content=f"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)} · Game Access</title>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#eee;font:16px/1.5 system-ui,sans-serif}}
main{{max-width:28rem;padding:2rem}}h1{{font-size:1.4rem;margin:0 0 .5rem}}p{{margin:0;color:#bbb}}</style></head>
<body><main><h1>{html.escape(title)}</h1><p>{text}</p></main></body></html>""")
