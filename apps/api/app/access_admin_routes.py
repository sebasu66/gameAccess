"""Access admin routes."""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import Session, select
from .models import AccessEvent
from .api_schemas import AccessKeyIssueRequest, AccessKeyRenewRequest
from .api_dependencies import get_session
from .access_keys import AccessKey, issue_keys, release_key, utc
from .access_service import now_utc, _admin_activation_access

router = APIRouter()

@router.post("/admin/access-keys")
def create_access_keys(req: AccessKeyIssueRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    if sum(value is not None for value in (req.duration_hours, req.duration_months, req.expires_at)) != 1:
        raise HTTPException(422, "Specify exactly one expires_at, duration_hours or duration_months")
    if req.expires_at is not None and (req.expires_at.tzinfo is None or req.expires_at.utcoffset() is None or utc(req.expires_at) <= now_utc()):
        raise HTTPException(422, "Expiry must be a future date with a timezone")
    keys = issue_keys(
        session,
        hours=req.duration_hours,
        months=req.duration_months,
        count=req.count,
        key_ttl_hours=req.key_ttl_hours,
        expires_at=req.expires_at,
        access_tier=req.access_tier,
        label=req.label,
    )
    return {"keys": [{"id": key_id, "key": key} for key_id, key in keys]}


@router.get("/admin/access-keys")
def list_access_keys(request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    rows = session.exec(select(AccessKey).order_by(AccessKey.id.desc())).all()
    return {"keys": [{
        "id": row.id,
        "duration_hours": row.duration_hours,
        "duration_months": row.duration_months,
        "access_tier": row.access_tier,
        "created_at": row.created_at,
        "key_expires_at": row.key_expires_at,
        "activated_at": row.activated_at,
        "expires_at": row.expires_at,
        "revoked_at": row.revoked_at,
        "installation_id": row.installation_id,
        "label": row.label,
    } for row in rows]}


@router.post("/admin/access-keys/{key_id}/renew")
def renew_access_key(key_id: int, req: AccessKeyRenewRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    if req.expires_at.tzinfo is None or req.expires_at.utcoffset() is None or utc(req.expires_at) <= now_utc():
        raise HTTPException(422, "Expiry must be a future date with a timezone")
    row = session.get(AccessKey, key_id)
    if row is None:
        raise HTTPException(404, "Activation key not found")
    if row.revoked_at is not None:
        raise HTTPException(409, "A revoked key cannot be renewed")
    if row.access_tier != "plus":
        raise HTTPException(409, "Manual payment renewal is only available for PLUS")
    target = utc(req.expires_at)
    if row.expires_at is not None and target <= utc(row.expires_at):
        raise HTTPException(409, "Renewal must extend the current expiry")
    row.expires_at = target
    if row.activated_at is None:
        row.key_expires_at = target
    session.add(row)
    session.commit()
    return {"id": row.id, "access_tier": row.access_tier, "expires_at": utc(row.expires_at)}


@router.post("/admin/access-keys/{key_id}/release")
def release_access_key(key_id: int, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    try:
        row = release_key(session, key_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"id": row.id, "released": True}


@router.post("/admin/access-keys/{key_id}/revoke")
def revoke_access_key(key_id: int, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    row = session.get(AccessKey, key_id)
    if row is None:
        raise HTTPException(404, "Activation key not found")
    row.revoked_at = now_utc()
    # Retain the digest for authenticated rejection metadata; revoked_at still
    # denies all access through valid_session and redeem_key.
    session.add(row)
    session.commit()
    return {"ok": True}


@router.get("/admin/access-events")
def list_access_events(
    request: Request,
    limit: int = Query(default=200, ge=1, le=1000),
    installation_id: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    outcome: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> dict:
    _admin_activation_access(request)
    statement = select(AccessEvent)
    if installation_id:
        statement = statement.where(AccessEvent.installation_id == installation_id)
    if action:
        statement = statement.where(AccessEvent.action == action)
    if outcome:
        statement = statement.where(AccessEvent.outcome == outcome)
    rows = session.exec(statement.order_by(AccessEvent.id.desc()).limit(limit)).all()
    return {
        "events": [
            {
                "id": row.id,
                "created_at": row.created_at,
                "installation_id": row.installation_id,
                "action": row.action,
                "outcome": row.outcome,
                "reason": row.reason,
                "game_id": row.game_id,
                "app_id": row.app_id,
                "lease_id": row.lease_id,
                "account_id": row.account_id,
            }
            for row in rows
        ]
    }
