"""Admin routes for Game Access users (accounts.py): list, create, mark paid / not paid, give or link a PLUS key."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, select
from .api_dependencies import get_session
from .api_schemas import AccountCreateRequest, AccountKeyRequest, AccountMembershipRequest
from .access_service import _admin_activation_access
from .accounts import Account, create_account, describe, issue_account_key, link_key, set_membership

router = APIRouter()


def _account(session: Session, account_id: int) -> Account:
    account = session.get(Account, account_id)
    if account is None:
        raise HTTPException(404, "account_not_found")
    return account


@router.get("/admin/users")
def list_accounts(request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    return {"accounts": [describe(session, account) for account in session.exec(select(Account).order_by(Account.id.desc())).all()]}


@router.post("/admin/users")
def add_account(req: AccountCreateRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    try:
        account = create_account(session, email=req.email, name=req.name, language=req.language, password=req.password)
    except ValueError as exc:
        raise HTTPException(409 if str(exc) == "email_taken" else 422, str(exc)) from exc
    return describe(session, account)


@router.post("/admin/users/{account_id}/membership")
def change_membership(account_id: int, req: AccountMembershipRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    """Seba marks the user paid until a date, or not paid: the user's PLUS keys follow at once."""
    _admin_activation_access(request)
    try:
        account = set_membership(session, _account(session, account_id), paid=req.paid, plus_until=req.plus_until, note=req.note)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return describe(session, account)


@router.post("/admin/users/{account_id}/keys")
def add_account_key(account_id: int, req: AccountKeyRequest, request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    account = _account(session, account_id)
    printable = None
    try:
        if req.key_id is None:
            _, printable = issue_account_key(session, account)
        else:
            link_key(session, account, req.key_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"account": describe(session, account), "key": printable}
