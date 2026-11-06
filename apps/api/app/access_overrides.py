"""Private reusable access key for developers and invited testers."""

from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, select

from .access_keys import canonical_installation_id, digest, expiration, utc


@dataclass(frozen=True)
class CourtesyKey:
    name: str
    value: str
    duration_months: int
    access_tier: str = "base"


class CourtesySession(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    session_hash: str = SQLField(index=True, unique=True)
    installation_id: str = SQLField(index=True)
    key_name: str
    key_fingerprint: str
    expires_at: datetime


def _default_config_path() -> Path:
    return Path(__file__).resolve().parent.parent / "courtesy-keys.json"


def _parse_local_file(data: object) -> list[CourtesyKey]:
    entries = data.get("keys") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise ValueError("Invalid courtesy keys file")

    keys: list[CourtesyKey] = []
    names: set[str] = set()
    values: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("Invalid courtesy key entry")
        name = entry.get("name")
        value = entry.get("key")
        months = entry.get("duration_months", 1)
        tier = entry.get("access_tier", "plus" if name == "developer" else "base")
        if (
            not isinstance(name, str)
            or not name.strip()
            or not isinstance(value, str)
            or not 8 <= len(value) <= 120
            or type(months) is not int
            or not 1 <= months <= 12
            or tier not in ("base", "plus")
            or name in names
            or value in values
        ):
            raise ValueError("Invalid or duplicate courtesy key entry")
        names.add(name)
        values.add(value)
        keys.append(CourtesyKey(name=name, value=value, duration_months=months, access_tier=tier))
    return keys


def _configured_keys() -> list[CourtesyKey]:
    # Production contract: this environment variable contains the filesystem
    # path to the private JSON file that contains the reusable courtesy keys.
    configured = os.environ.get("GAMEACCESS_COURTESY_KEYS_FILE", "").strip()
    path = Path(configured).expanduser() if configured else _default_config_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid courtesy keys file") from exc
    return _parse_local_file(data)



def courtesy_access_configured() -> bool:
    """Report configuration presence without exposing the courtesy key itself."""
    try:
        return bool(_configured_keys())
    except ValueError:
        return False


def redeem_courtesy_key(
    session: Session, printable: str, installation_id: str
) -> tuple[str, datetime] | None:
    match = next(
        (entry for entry in _configured_keys() if secrets.compare_digest(printable.strip(), entry.value)),
        None,
    )
    if match is None:
        return None
    installation_id = canonical_installation_id(installation_id)
    now = datetime.now(timezone.utc)
    expires_at = expiration(now, None, match.duration_months)
    token = secrets.token_urlsafe(32)
    session.add(CourtesySession(
        session_hash=digest(token),
        installation_id=installation_id,
        key_name=match.name,
        key_fingerprint=digest(match.value),
        expires_at=expires_at,
    ))
    session.commit()
    return token, expires_at


def valid_courtesy_session(
    session: Session, token: str, installation_id: str
) -> CourtesySession | None:
    try:
        installation_id = canonical_installation_id(installation_id)
    except ValueError:
        return None
    if not token or len(token) > 200:
        return None
    row = session.exec(select(CourtesySession).where(
        CourtesySession.session_hash == digest(token),
        CourtesySession.installation_id == installation_id,
    )).first()
    if row is None or utc(row.expires_at) <= datetime.now(timezone.utc):
        return None
    for entry in _configured_keys():
        if entry.name == row.key_name and secrets.compare_digest(
            digest(entry.value), row.key_fingerprint
        ):
            return row
    return None

def courtesy_access_tier(row: CourtesySession) -> str:
    """Only the private server configuration determines tester entitlements."""
    for entry in _configured_keys():
        if entry.name == row.key_name and secrets.compare_digest(digest(entry.value), row.key_fingerprint):
            return entry.access_tier
    return "base"
