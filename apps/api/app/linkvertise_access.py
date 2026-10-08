"""Verified Linkvertise return: one provider completion issues one 12-hour key.

Publisher configuration is server-owned. Never accept a client-provided success flag,
destination, duration, publisher token or reusable key file.
"""
from __future__ import annotations

import html
import os
import re
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlmodel import Field, Session, SQLModel, select

from . import main as core
from .access_keys import digest, issue_keys

router = APIRouter(prefix="/activation/free", tags=["activation"])


class LinkvertiseCompletion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    completion_hash: str = Field(unique=True, index=True)
    created_at: datetime
    # Record successful provider confirmations once. The unique index is the
    # final guard against concurrent/replayed issuance.


def publisher_config() -> tuple[str, str]:
    token = os.environ.get("GAMEACCESS_LINKVERTISE_ANTI_BYPASS_TOKEN", "").strip()
    link = os.environ.get("GAMEACCESS_LINKVERTISE_URL", "").strip()
    parsed = urlparse(link)
    valid_link = parsed.scheme == "https" and parsed.hostname in {"linkvertise.com", "www.linkvertise.com"} and not parsed.username and not parsed.password
    if not valid_link or not re.fullmatch(r"[0-9a-fA-F]{64}", token):
        return "", ""
    return link, token


async def verify_completion(token: str, completion_hash: str) -> bool:
    # Linkvertise hashes last ten seconds. Keep the validation attempt short,
    # use the official fixed endpoint and do not follow redirects.
    try:
        async with httpx.AsyncClient(timeout=4.0, follow_redirects=False) as client:
            response = await client.post(
                "https://publisher.linkvertise.com/api/v1/anti_bypassing",
                params={"token": token, "hash": completion_hash},
            )
        if response.status_code != 200:
            return False
        return response.text.strip().lower() == "true"
    except httpx.HTTPError:
        return False


def page(title: str, body: str, status: int = 200) -> HTMLResponse:
    document = f"""<!doctype html><html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>GameAccess · {html.escape(title)}</title>
<style>body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d11;color:#f5f5f5;font:16px system-ui}}
main{{width:min(520px,calc(100vw - 72px));padding:32px;border:1px solid #ffffff35;border-radius:18px;background:linear-gradient(145deg,#262830,#121418)}}
h1{{font-size:25px}}p{{color:#c8cad1;line-height:1.6}}small{{color:#aaaeb8}}input{{box-sizing:border-box;width:100%;padding:16px;border:1px solid #ff964e;border-radius:8px;background:#0c1017;color:white;font:18px monospace}}a{{color:#ffb27a}}</style>
<main><small>GAMEACCESS · BASE · BETA</small><h1>{html.escape(title)}</h1>{body}</main></html>"""
    return HTMLResponse(document, status_code=status, headers={
        "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    })


@router.get("/config")
def free_access_config():
    link, _ = publisher_config()
    return {"configured": bool(link)}


@router.get("/start")
def start_free_access():
    link, _ = publisher_config()
    if not link:
        return page("El pase gratuito aún no está disponible",
                    "<p>Estamos preparando el recorrido de anuncios. Volvé a GameAccess más tarde.</p><p>The free pass is being prepared. Please try again later.</p>", 503)
    # This route warms a sleeping server BEFORE handing the user to Linkvertise.
    return RedirectResponse(link, status_code=303, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@router.get("/return", response_class=HTMLResponse)
async def free_access_return(
    hash: str = Query(default="", max_length=64),
    session: Session = Depends(core.get_session),
):
    _, token = publisher_config()
    if not token:
        return page("El pase gratuito aún no está disponible",
                    "<p>La integración todavía no fue configurada. Integration is not configured yet.</p>", 503)
    if not re.fullmatch(r"[0-9a-fA-F]{64}", hash):
        return page("Completá el recorrido de anuncios",
                    '<p>Primero abrí el recorrido de Linkvertise. Complete the Linkvertise steps first.</p><a href="/activation/free/start">Comenzar / Start</a>', 403)
    fingerprint = digest(hash.lower())
    if session.exec(select(LinkvertiseCompletion).where(LinkvertiseCompletion.completion_hash == fingerprint)).first():
        return page("Este recorrido ya fue procesado",
                    "<p>Cada recorrido puede generar una sola clave. Si ya la recibiste, pegala en GameAccess. Each completion can issue only one key.</p>", 409)
    if not await verify_completion(token, hash):
        return page("No pudimos confirmar los anuncios",
                    '<p>El recorrido no es válido o la confirmación venció. No se generó ninguna clave. The confirmation is invalid or expired; no key was issued.</p><a href="/activation/free/start">Volver a intentar / Try again</a>', 403)
    from sqlalchemy.exc import IntegrityError
    try:
        session.add(LinkvertiseCompletion(completion_hash=fingerprint, created_at=datetime.now(timezone.utc)))
        session.commit()
    except IntegrityError:
        session.rollback()
        return page("Este recorrido ya fue procesado", "<p>Volvé a GameAccess con tu clave. Return to GameAccess with your key.</p>", 409)
    _, key = issue_keys(session, hours=12, months=None, count=1, key_ttl_hours=24)[0]
    return page("Tu clave BASE está lista",
                f'<p>Copiá esta clave y pegala en GameAccess. Copy this key into GameAccess.</p><input readonly aria-label="Clave / Access key" value="{html.escape(key, quote=True)}">'
                '<p>12 horas desde la activación. Activala dentro de 24 horas. / 12 hours from activation. Activate within 24 hours.</p>'
                '<small>Guardá la clave antes de cerrar: esta página no vuelve a mostrarla. Save the key before closing; it is shown only once.</small>')
