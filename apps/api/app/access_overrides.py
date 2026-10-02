"""Private reusable access keys for developers and invited testers."""

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


class CourtesySession(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    session_hash: str = SQLField(index=True, unique=True)
    installation_id: str = SQLField(index=True)
    key_name: str
    key_fingerprint: str
    expires_at: datetime


def _default_config_path() -> Path:
    return Path(__file__).resolve().parent.parent / "courtesy-keys.json"


def _parse_config(data: object, *, source: str) -> list[CourtesyKey]:
    entries = data.get("keys") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        raise ValueError(f"Invalid courtesy keys configuration from {source}")

    keys: list[CourtesyKey] = []
    names: set[str] = set()
    values: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError(f"Invalid courtesy key entry from {source}")
        name = entry.get("name")
        value = entry.get("key")
        months = entry.get("duration_months", 1)
        if (
            not isinstance(name, str)
            or not name.strip()
            or not isinstance(value, str)
            or not 8 <= len(value) <= 120
            or type(months) is not int
            or not 1 <= months <= 12
            or name in names
            or value in values
        ):
            raise ValueError(f"Invalid or duplicate courtesy key entry from {source}")
        names.add(name)
        values.add(value)
        keys.append(CourtesyKey(name=name, value=value, duration_months=months))
    return keys


def _single_key(value: str, *, source: str) -> list[CourtesyKey]:
    value = value.strip()
    if not 8 <= len(value) <= 120:
        raise ValueError(f"Invalid courtesy key from {source}")
    months_text = os.environ.get("GAMEACCESS_COURTESY_DURATION_MONTHS", "1").strip() or "1"
    try:
        months = int(months_text)
    except ValueError as exc:
        raise ValueError("Invalid GAMEACCESS_COURTESY_DURATION_MONTHS") from exc
    if not 1 <= months <= 12:
        raise ValueError("Invalid GAMEACCESS_COURTESY_DURATION_MONTHS")
    return [CourtesyKey(name="courtesy", value=value, duration_months=months)]


def _configured_keys() -> list[CourtesyKey]:
    # Preferred production configuration: keep the reusable key/configuration
    # directly in a Render secret environment variable. Accept the historical
    # aliases so deployment configuration does not have to change when the
    # loader implementation changes.
    for env_name in ("GAMEACCESS_COURTESY_KEYS", "GAMEACCESS_COURTESY_KEYS_JSON"):
        direct_json = os.environ.get(env_name, "").strip()
        if direct_json:
            try:
                return _parse_config(json.loads(direct_json), source=env_name)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON in {env_name}") from exc

    for env_name in ("GAMEACCESS_COURTESY_KEY", "COURTESY_KEY"):
        direct_key = os.environ.get(env_name, "").strip()
        if direct_key:
            return _single_key(direct_key, source=env_name)

    # Backward compatibility: GAMEACCESS_COURTESY_KEYS_FILE historically named
    # the setting even when deployment configuration treated it as a secret
    # variable. Accept JSON or a direct key here before interpreting it as a
    # filesystem path.
    configured = os.environ.get("GAMEACCESS_COURTESY_KEYS_FILE", "").strip()
    if configured:
        if configured.startswith("{") or configured.startswith("["):
            try:
                return _parse_config(
                    json.loads(configured), source="GAMEACCESS_COURTESY_KEYS_FILE"
                )
            except json.JSONDecodeError as exc:
                raise ValueError("Invalid JSON in GAMEACCESS_COURTESY_KEYS_FILE") from exc

        configured_path = Path(configured)
        if configured_path.exists():
            try:
                data = json.loads(configured_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                raise ValueError("Invalid courtesy keys file") from exc
            return _parse_config(data, source=str(configured_path))

        # If the value clearly looks like a path, do not accidentally accept
        # the path string itself as an access key.
        if "/" in configured or "\\" in configured or configured.lower().endswith(".json"):
            return []

        return _single_key(configured, source="GAMEACCESS_COURTESY_KEYS_FILE")

    # Local-development compatibility. This file remains private/ignored and is
    # not required in production when a secret environment variable is used.
    path = _default_config_path()
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid courtesy keys file") from exc
    return _parse_config(data, source=str(path))


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


def courtesy_access_configured() -> bool:
    """Report configuration presence without exposing the courtesy key itself."""
    try:
        return bool(_configured_keys())
    except ValueError:
        return False
