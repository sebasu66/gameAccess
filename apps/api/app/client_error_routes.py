"""Client error routes."""
from __future__ import annotations
import html
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select
from .models import ClientErrorReport
from .api_schemas import ClientErrorReportRequest
from .api_dependencies import get_session
from .access_keys import canonical_installation_id
from .access_service import now_utc, _activation_for_request, _admin_activation_access
from .admin_security import _admin_browser_access

router = APIRouter()

_CLIENT_ERROR_SECRET_PATTERNS = (
    re.compile(r"(?i)(?:https?://|magnet:\?|postgres(?:ql)?://)[^\s]+"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)(password|session[_ -]?token|activation[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+"),
    re.compile(r"(?i)(client_public_key)\s*[:=]\s*[^\s,;]+"),
)


def _sanitize_client_error_message(value: str) -> str:
    clean = re.sub(r"\s+", " ", str(value or "")).strip()
    clean = re.sub(r"(?i)C:\\Users\\[^\\\s]+", r"C:\\Users\\[user]", clean)
    for pattern in _CLIENT_ERROR_SECRET_PATTERNS:
        clean = pattern.sub("[redacted]", clean)
    return clean[:4000]


@router.post("/client-errors")
def report_client_error(
    req: ClientErrorReportRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    if _activation_for_request(request, session) is None:
        raise HTTPException(401, "GameAccess activation is required or has expired")
    installation_id = canonical_installation_id(
        request.headers.get("X-GameAccess-Installation", "")
    )
    message = _sanitize_client_error_message(req.message)
    if not message:
        raise HTTPException(422, "Client error message is empty")
    row = ClientErrorReport(
        installation_id=installation_id,
        area=re.sub(r"[^A-Za-z0-9 _.-]", "", req.area).strip()[:80] or "APP",
        message=message,
        app_id=req.app_id,
        lease_id=req.lease_id,
        client_build=req.client_build.strip()[:120],
        user_agent=request.headers.get("User-Agent", "")[:500],
        created_at=now_utc(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return {"ok": True, "id": row.id}


def _client_error_rows(
    session: Session,
    *,
    limit: int,
    area: str | None = None,
    installation_id: str | None = None,
) -> list[ClientErrorReport]:
    statement = select(ClientErrorReport)
    if area:
        statement = statement.where(ClientErrorReport.area == area)
    if installation_id:
        statement = statement.where(ClientErrorReport.installation_id == installation_id)
    return list(
        session.exec(
            statement.order_by(ClientErrorReport.id.desc()).limit(limit)
        ).all()
    )


@router.get("/admin/client-errors")
def admin_client_errors(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    area: str | None = Query(default=None, max_length=80),
    installation_id: str | None = Query(default=None, max_length=36),
    session: Session = Depends(get_session),
) -> dict:
    _admin_activation_access(request)
    rows = _client_error_rows(
        session,
        limit=limit,
        area=area,
        installation_id=installation_id,
    )
    return {
        "errors": [
            {
                "id": row.id,
                "created_at": row.created_at,
                "installation_id": row.installation_id,
                "area": row.area,
                "message": row.message,
                "app_id": row.app_id,
                "lease_id": row.lease_id,
                "client_build": row.client_build,
                "user_agent": row.user_agent,
            }
            for row in rows
        ]
    }


@router.get("/admin/client-errors/view", response_class=HTMLResponse)
def admin_client_errors_view(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    area: str | None = Query(default=None, max_length=80),
    session: Session = Depends(get_session),
) -> HTMLResponse:
    _admin_browser_access(request)
    rows = _client_error_rows(session, limit=limit, area=area)
    body_rows = "".join(
        "<tr>"
        f"<td>{row.id}</td>"
        f"<td>{html.escape(row.created_at.isoformat())}</td>"
        f"<td>{html.escape(row.area)}</td>"
        f"<td>{row.app_id or ''}</td>"
        f"<td>{row.lease_id or ''}</td>"
        f"<td><code>{html.escape(row.installation_id)}</code></td>"
        f"<td>{html.escape(row.client_build or '')}</td>"
        f"<td class='message'>{html.escape(row.message)}</td>"
        "</tr>"
        for row in rows
    )
    page = f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GameAccess · errores de clientes</title>
<style>
body{{font:14px system-ui,sans-serif;margin:24px;background:#111827;color:#e5e7eb}}
h1{{font-size:22px}} .meta{{color:#9ca3af;margin-bottom:18px}}
table{{width:100%;border-collapse:collapse;background:#1f2937}}
th,td{{padding:8px 10px;border-bottom:1px solid #374151;text-align:left;vertical-align:top}}
th{{position:sticky;top:0;background:#111827}} code{{font-size:11px}}
.message{{max-width:680px;white-space:pre-wrap;word-break:break-word}}
</style>
</head>
<body>
<h1>Errores de clientes GameAccess</h1>
<div class="meta">Últimos {len(rows)} reportes · más recientes primero · <a href="/health" style="color:#93c5fd">health</a></div>
<table>
<thead><tr><th>ID</th><th>Fecha UTC</th><th>Área</th><th>AppID</th><th>Lease</th><th>Instalación</th><th>Build</th><th>Error</th></tr></thead>
<tbody>{body_rows}</tbody>
</table>
</body></html>"""
    return HTMLResponse(page, headers={"Cache-Control": "no-store"})
