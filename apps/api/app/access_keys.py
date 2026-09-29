"""Server-owned activation keys and installation sessions.

The printable key and session token are returned once. Only their SHA-256
digests are kept in the database; both values contain 256 bits of randomness.
"""

from __future__ import annotations

import calendar
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import or_, update
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, select


class AccessKey(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    key_hash: str = SQLField(index=True, unique=True)
    duration_hours: Optional[int] = None
    duration_months: Optional[int] = None
    created_at: datetime
    activated_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    installation_id: Optional[str] = SQLField(default=None, index=True)
    session_hash: Optional[str] = SQLField(default=None, index=True)
    revoked_at: Optional[datetime] = None


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def digest(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def canonical_installation_id(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, AttributeError) as exc:
        raise ValueError("Invalid installation identifier") from exc


def expiration(start: datetime, hours: int | None, months: int | None) -> datetime:
    if hours is not None:
        return start + timedelta(hours=hours)
    assert months is not None
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


def issue_keys(session: Session, *, hours: int | None, months: int | None, count: int) -> list[tuple[int, str]]:
    issued: list[tuple[AccessKey, str]] = []
    for _ in range(count):
        printable = f"GA-{secrets.token_urlsafe(32)}"
        row = AccessKey(
            key_hash=digest(printable),
            duration_hours=hours,
            duration_months=months,
            created_at=datetime.now(timezone.utc),
        )
        session.add(row)
        issued.append((row, printable))
    session.commit()
    return [(int(row.id), printable) for row, printable in issued if row.id is not None]


def redeem_key(session: Session, printable: str, installation_id: str) -> tuple[str, datetime]:
    installation_id = canonical_installation_id(installation_id)
    row = session.exec(select(AccessKey).where(AccessKey.key_hash == digest(printable.strip()))).first()
    now = datetime.now(timezone.utc)
    if row is None or row.revoked_at is not None:
        raise ValueError("Invalid or unavailable activation key")
    if row.installation_id is not None and row.installation_id != installation_id:
        raise ValueError("This key is already active on another installation")
    if row.expires_at is not None and utc(row.expires_at) <= now:
        raise ValueError("This activation has expired")

    expires_at = utc(row.expires_at) if row.expires_at is not None else expiration(
        now, row.duration_hours, row.duration_months
    )
    token = secrets.token_urlsafe(32)
    # The conditional UPDATE makes first redemption single-installation even
    # when two requests arrive at the same time on separate server workers.
    changed = session.exec(
        update(AccessKey)
        .where(
            AccessKey.id == row.id,
            AccessKey.revoked_at.is_(None),
            or_(AccessKey.installation_id.is_(None), AccessKey.installation_id == installation_id),
        )
        .values(
            installation_id=installation_id,
            activated_at=row.activated_at or now,
            expires_at=expires_at,
            session_hash=digest(token),
        )
    )
    if changed.rowcount != 1:
        session.rollback()
        raise ValueError("This key is already active on another installation")
    session.commit()
    return token, expires_at


def valid_session(session: Session, token: str, installation_id: str) -> AccessKey | None:
    try:
        installation_id = canonical_installation_id(installation_id)
    except ValueError:
        return None
    if not token or len(token) > 200:
        return None
    row = session.exec(
        select(AccessKey).where(
            AccessKey.session_hash == digest(token),
            AccessKey.installation_id == installation_id,
            AccessKey.revoked_at.is_(None),
        )
    ).first()
    if row is None or row.expires_at is None or utc(row.expires_at) <= datetime.now(timezone.utc):
        return None
    return row

