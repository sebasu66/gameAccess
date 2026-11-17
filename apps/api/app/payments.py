"""Payments (US.2): Patreon and Mercado Pago tell the server who paid; the server keeps the membership (accounts.py).

Every provider is reduced to the same small event: **who** (the payer's email, how the user is found or created),
**what** (`paid`, `failed` or `canceled`) and, for a payment, **until when** it covers. Only `paid` changes the
membership: it extends `plus_until`, so a failed payment or a cancellation needs nothing more: PLUS simply is not
extended and ends on its own date (accounts.sync_keys already ends the keys then). The first payment also issues the
user's PLUS key, which the app shows once the player signs in.

Idempotent: a provider repeats its notices, so each (provider, event id) is applied once.
Nothing here knows the secrets: they come from the environment (``GAMEACCESS_PATREON_SECRET``,
``GAMEACCESS_MERCADOPAGO_SECRET`` and ``GAMEACCESS_MERCADOPAGO_TOKEN``) and a provider without its secret answers 503.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, UniqueConstraint, select

from .access_keys import utc
from .accounts import Account, account_keys, create_account, issue_account_key, normalize_email, now_utc, plus_active, set_membership

logger = logging.getLogger("gameaccess.payments")
PROVIDERS = ("patreon", "mercadopago", "manual")
KINDS = ("paid", "failed", "canceled")
# A month of PLUS, plus a few days of slack so a payment that arrives a little late never cuts the service.
PERIOD = timedelta(days=31)
GRACE = timedelta(days=3)


class PaymentEvent(SQLModel, table=True):
    """What a provider told us, once each: the history behind a user's membership."""
    __table_args__ = (UniqueConstraint("provider", "event_id", name="uq_payment_event"),)
    id: Optional[int] = SQLField(default=None, primary_key=True)
    provider: str = SQLField(index=True)
    event_id: str
    account_id: Optional[int] = SQLField(default=None, index=True, foreign_key="account.id")
    kind: str
    amount_cents: Optional[int] = None
    currency: Optional[str] = None
    covers_until: Optional[datetime] = None
    created_at: datetime


class Event:
    """A provider's notice, in the one shape the rest understands."""

    def __init__(self, provider: str, event_id: str, email: str, kind: str, *, name: str | None = None, covers_until: datetime | None = None,
                 amount_cents: int | None = None, currency: str | None = None) -> None:
        if provider not in PROVIDERS or kind not in KINDS:
            raise ValueError("invalid_event")
        self.provider, self.event_id, self.kind = provider, str(event_id)[:120], kind
        self.email, self.name = normalize_email(email), (name or "").strip()[:80]
        self.covers_until, self.amount_cents, self.currency = covers_until, amount_cents, currency


def _user_for(session: Session, event: Event) -> Account:
    account = session.exec(select(Account).where(Account.email == event.email)).first()
    if account is not None:
        return account
    # Someone who paid before ever signing in: the account is waiting for them (their email is the way in).
    return create_account(session, email=event.email, name=event.name or event.email.split("@")[0])


def apply(session: Session, event: Event, now: datetime | None = None) -> dict:
    """Records the event and, for a payment, extends the membership. Returns what happened, for the log and the console."""
    now = now or now_utc()
    if session.exec(select(PaymentEvent).where(PaymentEvent.provider == event.provider, PaymentEvent.event_id == event.event_id)).first():
        return {"applied": False, "reason": "already_seen"}
    account = _user_for(session, event)
    session.add(PaymentEvent(provider=event.provider, event_id=event.event_id, account_id=account.id, kind=event.kind,
                             amount_cents=event.amount_cents, currency=event.currency, covers_until=event.covers_until, created_at=now))
    try:
        session.commit()
    except IntegrityError:  # two notices of the same event at once: the other one applied it
        session.rollback()
        return {"applied": False, "reason": "already_seen"}
    result = {"applied": True, "kind": event.kind, "account_id": account.id, "email": account.email, "new_key": None}
    if event.kind == "paid":
        # From today, or from where the current period ends if the player renewed early; never less than what was paid.
        base = max(now, utc(account.plus_until)) if account.plus_until and plus_active(account, now) else now
        until = max(utc(event.covers_until) if event.covers_until else base + PERIOD, base) + GRACE
        set_membership(session, account, paid=True, plus_until=until, note=f"{event.provider}: {event.event_id}")
        if not any(key.access_tier == "plus" and key.revoked_at is None for key in account_keys(session, account)):
            _, printable = issue_account_key(session, account)
            result["new_key"] = printable
    else:
        # Not extended: it ends on its own date. The note tells Seba in the console why.
        account.paid_note = f"{event.provider}: {event.kind} ({event.event_id})"[:200]
        session.add(account)
        session.commit()
    session.refresh(account)
    result["plus_until"] = utc(account.plus_until) if account.plus_until else None
    logger.info("payment %s/%s %s -> account %s", event.provider, event.event_id, event.kind, account.id)
    return result


# ---- Patreon: the webhook carries the member and the user (with scope identity[email]) ----

def patreon_signature_ok(body: bytes, signature: str, secret: str) -> bool:
    """Patreon signs the raw body with HMAC-MD5 (their documented scheme) and sends it in X-Patreon-Signature."""
    expected = hmac.new(secret.encode(), body, hashlib.md5).hexdigest()  # noqa: S324 - the provider's own scheme
    return hmac.compare_digest(expected, (signature or "").strip().lower())


def patreon_event(trigger: str, payload: dict) -> Event | None:
    """`members:pledge:create|update|delete` and `members:create|update|delete` → an event, or None if it says nothing about money."""
    data = payload.get("data") or {}
    attributes = data.get("attributes") or {}
    email = attributes.get("email") or next((item.get("attributes", {}).get("email") for item in payload.get("included", []) if item.get("type") == "user"), None)
    if not email or not data.get("id"):
        return None
    status = attributes.get("patron_status")
    next_charge = attributes.get("next_charge_date")
    when = datetime.fromisoformat(next_charge.replace("Z", "+00:00")) if next_charge else None
    last_charge = attributes.get("last_charge_status")
    if trigger.endswith(":delete") or status == "former_patron":
        kind = "canceled"
    elif last_charge in ("Declined", "Fraud", "Refunded", "Deleted"):
        kind = "failed"
    elif status == "active_patron" and last_charge == "Paid":
        kind = "paid"
    else:
        return None
    # One event per charge: the member and the charge's date, so a repeated notice is not a second payment.
    stamp = attributes.get("last_charge_date") or (next_charge or "")
    return Event("patreon", f"{data['id']}:{kind}:{stamp}", email, kind, name=attributes.get("full_name"), covers_until=when,
                 amount_cents=attributes.get("currently_entitled_amount_cents"), currency=attributes.get("currency"))


# ---- Mercado Pago: the notice is only an id; the payment is read back with the server's own token ----

def mercadopago_signature_ok(data_id: str, request_id: str, header: str, secret: str) -> bool:
    """`x-signature: ts=…,v1=…`, signed over `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (Mercado Pago's documented template)."""
    parts = dict(piece.strip().split("=", 1) for piece in (header or "").split(",") if "=" in piece)
    if "ts" not in parts or "v1" not in parts:
        return False
    # Per the docs' samples: the id as in the URL's query (lower-cased when alphanumeric), the request id and the ts.
    manifest = f"id:{data_id.lower()};request-id:{request_id};ts:{parts['ts']};"
    return hmac.compare_digest(hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest(), parts["v1"])


def mercadopago_event(payment: dict) -> Event | None:
    """A payment read from Mercado Pago's API (`GET /v1/payments/{id}`) → an event."""
    status = payment.get("status")
    email = (payment.get("payer") or {}).get("email")
    if not email or not payment.get("id"):
        return None
    kind = {"approved": "paid", "rejected": "failed", "cancelled": "failed", "refunded": "canceled", "charged_back": "canceled"}.get(status)
    if kind is None:  # pending / in process: nothing yet
        return None
    amount = payment.get("transaction_amount")
    return Event("mercadopago", f"{payment['id']}:{kind}", email, kind, name=(payment.get("payer") or {}).get("first_name"),
                 amount_cents=round(amount * 100) if isinstance(amount, (int, float)) else None, currency=payment.get("currency_id"))


def mercadopago_subscription_event(subscription: dict) -> Event | None:
    """A subscription read from `GET /preapproval/{id}`: only its end matters here (the charges arrive as payments)."""
    email = subscription.get("payer_email")
    if not email or not subscription.get("id") or subscription.get("status") not in ("cancelled", "canceled"):
        return None
    return Event("mercadopago", f"{subscription['id']}:canceled", email, "canceled")


def provider_secret(provider: str) -> str | None:
    return os.environ.get(f"GAMEACCESS_{provider.upper()}_SECRET") or None
