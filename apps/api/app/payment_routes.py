"""Payment notices (payments.py): the providers' webhooks, and the admin's list and simulator.

The simulator is how the flow is tried without a real payment (the app's own MCP tools call it on a test server, with
the admin token): it goes through the same `apply` the webhooks do."""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .access_service import _admin_activation_access
from .api_dependencies import get_session
from .payments import KINDS, PROVIDERS, Event, PaymentEvent, apply, mercadopago_event, mercadopago_signature_ok, mercadopago_subscription_event, patreon_event, patreon_signature_ok, provider_secret

router = APIRouter()
MERCADOPAGO_API = "https://api.mercadopago.com"


class SimulatedPayment(BaseModel):
    provider: str = "manual"
    email: str
    kind: str = "paid"
    name: Optional[str] = Field(default=None, max_length=80)
    covers_until: Optional[datetime] = None
    event_id: Optional[str] = Field(default=None, max_length=120)


def _need_secret(provider: str) -> str:
    secret = provider_secret(provider)
    if not secret:
        raise HTTPException(503, f"{provider}_not_configured")
    return secret


@router.post("/payments/patreon/webhook")
async def patreon_webhook(request: Request, session: Session = Depends(get_session)) -> dict:
    body = await request.body()
    if not patreon_signature_ok(body, request.headers.get("X-Patreon-Signature", ""), _need_secret("patreon")):
        raise HTTPException(403, "bad_signature")
    try:
        event = patreon_event(request.headers.get("X-Patreon-Event", ""), json.loads(body))
    except (ValueError, KeyError) as exc:
        raise HTTPException(422, "bad_payload") from exc
    return apply(session, event) if event else {"applied": False, "reason": "not_about_money"}


async def _mp_get(client: httpx.AsyncClient, token: str, path: str) -> dict:
    reply = await client.get(f"{MERCADOPAGO_API}{path}", headers={"Authorization": f"Bearer {token}"})
    reply.raise_for_status()
    return reply.json()


@router.post("/payments/mercadopago/webhook")
async def mercadopago_webhook(request: Request, session: Session = Depends(get_session)) -> dict:
    """The notice names a resource (`data.id`); it is checked against the signature and read back from Mercado Pago.

    Topics (docs "Webhooks"): `payment` (includes subscriptions' charges), `subscription_authorized_payment` (a recurring
    charge: its invoice holds the payment's id) and `subscription_preapproval` (the subscription itself: a cancellation)."""
    secret, token = _need_secret("mercadopago"), os.environ.get("GAMEACCESS_MERCADOPAGO_TOKEN")
    if not token:
        raise HTTPException(503, "mercadopago_not_configured")
    try:
        notice = await request.json()
    except ValueError as exc:
        raise HTTPException(422, "bad_payload") from exc
    # The signature is over the id in the URL's query (`data.id`), as the docs' SDK samples read it; the body repeats it.
    data_id = str(request.query_params.get("data.id") or (notice.get("data") or {}).get("id") or "")
    if not data_id or not mercadopago_signature_ok(data_id, request.headers.get("x-request-id", ""), request.headers.get("x-signature", ""), secret):
        raise HTTPException(403, "bad_signature")
    topic = notice.get("type") or request.query_params.get("type") or request.query_params.get("topic")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if topic == "payment":
                event = mercadopago_event(await _mp_get(client, token, f"/v1/payments/{data_id}"))
            elif topic == "subscription_authorized_payment":
                invoice = await _mp_get(client, token, f"/authorized_payments/{data_id}")
                payment_id = (invoice.get("payment") or {}).get("id")
                event = mercadopago_event(await _mp_get(client, token, f"/v1/payments/{payment_id}")) if payment_id else None
            elif topic == "subscription_preapproval":
                event = mercadopago_subscription_event(await _mp_get(client, token, f"/preapproval/{data_id}"))
            else:
                return {"applied": False, "reason": "not_about_money"}
    except httpx.HTTPError as exc:
        raise HTTPException(502, "mercadopago_unreachable") from exc
    return apply(session, event) if event else {"applied": False, "reason": "not_final"}


@router.get("/admin/payments")
def list_payments(request: Request, session: Session = Depends(get_session)) -> dict:
    _admin_activation_access(request)
    rows = session.exec(select(PaymentEvent).order_by(PaymentEvent.id.desc()).limit(100)).all()
    return {"payments": [row.model_dump() for row in rows]}


@router.post("/admin/payments/simulate")
def simulate_payment(req: SimulatedPayment, request: Request, session: Session = Depends(get_session)) -> dict:
    """A payment as a provider would report it, without one: the same path, for trying the flow."""
    _admin_activation_access(request)
    if req.provider not in PROVIDERS or req.kind not in KINDS:
        raise HTTPException(422, "invalid_event")
    try:
        event = Event(req.provider, req.event_id or f"sim-{datetime.now().timestamp()}", req.email, req.kind, name=req.name, covers_until=req.covers_until)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return apply(session, event)
