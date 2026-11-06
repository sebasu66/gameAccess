"""Game Access users (US.1; vault/Modo niño.md, "Usuarios y PLUS").

A user has a name, an email, a language and, optionally, a password (kept only as a salted scrypt hash). PLUS comes
from the user's membership: **paid / not paid** and **until when**, which Seba sets by hand in the admin console until
monthly billing exists (US.2). The user's PLUS keys follow that membership: their end date is copied from it, so the
activation paths (`access_keys.valid_session`, `/activation/status`) and the client's reaction to an ended PLUS
(MN.15) need no change. Paid: the keys run until `plus_until`. Not paid (or the date passed): the keys end now, the
client hears "expired" and pauses kid mode and the parent's key.

The table is `account`, not `user`: `user` is a reserved word in Postgres and already holds the old credits table.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, select

from .access_keys import AccessKey, issue_keys, reveal_key, utc

# "Por vencer" in the console: PLUS ends within this many days.
EXPIRING_DAYS = 7
LANGUAGES = ("es", "en")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# scrypt cost: 2^14 rounds and 16 MiB, the standard library's interactive-login parameters.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1


class Account(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    email: str = SQLField(index=True, unique=True)
    name: str
    language: str = "es"
    created_at: datetime
    password_hash: Optional[str] = None
    # The membership, set by hand in the admin console: PLUS while paid and until `plus_until`.
    paid: bool = False
    plus_until: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    paid_note: Optional[str] = None


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def normalize_email(email: str) -> str:
    email = (email or "").strip().lower()
    if len(email) > 254 or not _EMAIL.match(email):
        raise ValueError("invalid_email")
    return email


def hash_password(password: str) -> str:
    if not 8 <= len(password or "") <= 200:
        raise ValueError("invalid_password")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    encode = lambda raw: base64.b64encode(raw).decode("ascii")
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${encode(salt)}${encode(digest)}"


def check_password(account: Account, password: str) -> bool:
    try:
        scheme, n, r, p, salt, expected = (account.password_hash or "").split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt((password or "").encode("utf-8"), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(digest, base64.b64decode(expected))
    except (ValueError, TypeError):
        return False


def create_account(session: Session, *, email: str, name: str, language: str = "es", password: str | None = None) -> Account:
    name = (name or "").strip()[:80]
    if not name:
        raise ValueError("invalid_name")
    if language not in LANGUAGES:
        raise ValueError("invalid_language")
    account = Account(email=normalize_email(email), name=name, language=language, created_at=now_utc(),
                      password_hash=hash_password(password) if password else None)
    session.add(account)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise ValueError("email_taken") from None
    session.refresh(account)
    return account


def plus_active(account: Account, now: datetime | None = None) -> bool:
    return account.paid and account.plus_until is not None and utc(account.plus_until) > (now or now_utc())


def account_keys(session: Session, account: Account) -> list[AccessKey]:
    return list(session.exec(select(AccessKey).where(AccessKey.account_id == account.id).order_by(AccessKey.id)).all())


def membership_state(account: Account, keys: list[AccessKey], now: datetime | None = None) -> str:
    """What the console shows: "no_key", "unpaid", "expiring" (PLUS ends within a week) or "paid"."""
    now = now or now_utc()
    if not any(key.access_tier == "plus" and key.revoked_at is None for key in keys):
        return "no_key"
    if not plus_active(account, now):
        return "unpaid"
    return "expiring" if utc(account.plus_until) - now <= timedelta(days=EXPIRING_DAYS) else "paid"


def sync_keys(session: Session, account: Account, now: datetime | None = None) -> None:
    """Copies the membership to the user's PLUS keys: running until `plus_until` while paid, ended now otherwise.

    A revoked key stays revoked; an ended key keeps its session, so paying again brings the same PC back."""
    now = now or now_utc()
    active = plus_active(account, now)
    for key in account_keys(session, account):
        if key.access_tier != "plus" or key.revoked_at is not None:
            continue
        if active:
            end = utc(account.plus_until)
        elif key.expires_at is None or utc(key.expires_at) > now:
            end = now
        else:
            continue
        key.expires_at = end
        if key.activated_at is None:
            key.key_expires_at = end
        session.add(key)
    session.commit()


def set_membership(session: Session, account: Account, *, paid: bool, plus_until: datetime | None, note: str | None = None) -> Account:
    if plus_until is not None and (plus_until.tzinfo is None or plus_until.utcoffset() is None):
        raise ValueError("date_needs_timezone")
    if paid and plus_until is None:
        raise ValueError("paid_needs_date")
    if paid and not account.paid:
        account.paid_at = now_utc()
    account.paid = paid
    account.plus_until = utc(plus_until) if plus_until is not None else account.plus_until
    account.paid_note = (note or "").strip()[:200] or None
    session.add(account)
    session.commit()
    sync_keys(session, account)
    session.refresh(account)
    return account


def link_key(session: Session, account: Account, key_id: int) -> AccessKey:
    key = session.get(AccessKey, key_id)
    if key is None:
        raise LookupError("key_not_found")
    if key.access_tier != "plus" or key.revoked_at is not None:
        raise ValueError("key_not_linkable")
    if key.account_id not in (None, account.id):
        raise ValueError("key_has_other_account")
    key.account_id = account.id
    session.add(key)
    session.commit()
    sync_keys(session, account)
    session.refresh(key)
    return key


def issue_account_key(session: Session, account: Account) -> tuple[int, str]:
    """A new PLUS key for the user, already following the membership. Returns its id and printable form (once)."""
    [(key_id, printable)] = issue_keys(session, hours=None, months=1, count=1, access_tier="plus", label=account.name)
    link_key(session, account, key_id)
    return key_id, printable


def describe(session: Session, account: Account, now: datetime | None = None) -> dict:
    """The user as the admin console shows it. Never the password or its hash."""
    keys = account_keys(session, account)
    return {
        "id": account.id, "email": account.email, "name": account.name, "language": account.language,
        "created_at": utc(account.created_at), "has_password": account.password_hash is not None,
        "paid": account.paid, "plus_until": utc(account.plus_until) if account.plus_until else None,
        "paid_at": utc(account.paid_at) if account.paid_at else None, "paid_note": account.paid_note,
        "plus_active": plus_active(account, now), "state": membership_state(account, keys, now),
        "keys": [{"id": key.id, "key": reveal_key(key), "access_tier": key.access_tier,
                  "activated_at": utc(key.activated_at) if key.activated_at else None,
                  "expires_at": utc(key.expires_at) if key.expires_at else None,
                  "revoked_at": utc(key.revoked_at) if key.revoked_at else None,
                  "installation_id": key.installation_id,
                  "last_seen_at": utc(key.last_seen_at) if key.last_seen_at else None} for key in keys],
    }
