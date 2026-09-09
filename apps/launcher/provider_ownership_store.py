"""Per-provider authoritative Steam ownership for the GameAccess pool.

Each provider is updated independently. A complete successful SteamKit scan replaces
that provider's owned AppIDs. A failed scan records operational failure but never
erases the provider's last verified ownership. This is the only ownership authority
used by the GameAccess pool builder.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_STORE = Path(__file__).resolve().parent / ".gameaccess" / "provider_ownership.db"


def _timestamp(value: object) -> float:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError("scan verified_at is required")
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("scan verified_at must include timezone")
    return parsed.astimezone(timezone.utc).timestamp()


def _app_ids(row: dict[str, Any] | None) -> list[int]:
    return sorted(
        {
            int(app_id)
            for app_id in (row or {}).get("owned_app_ids") or []
            if str(app_id).isdigit() and int(app_id) > 0
        }
    )


class ProviderOwnershipStore:
    """Durable ownership state keyed by opaque provider ID."""

    def __init__(self, path: Path = DEFAULT_STORE) -> None:
        self.path = Path(path)

    def record_scan(self, inventory: dict[str, Any]) -> dict[str, int]:
        """Record one scan attempt and promote every complete successful provider."""
        stamp = _timestamp(inventory.get("verified_at"))
        verified_at = str(inventory.get("verified_at") or "")
        source = str(inventory.get("source") or "steamkit-license-list-pics")
        accounts = {
            str(row.get("provider_id") or ""): row
            for row in inventory.get("accounts") or []
            if isinstance(row, dict) and str(row.get("provider_id") or "")
        }
        errors = {
            str(row.get("provider_id") or ""): row
            for row in inventory.get("errors") or []
            if isinstance(row, dict) and str(row.get("provider_id") or "")
        }
        scans = [row for row in inventory.get("scans") or [] if isinstance(row, dict)]

        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=30)
        promoted = 0
        attempted = 0
        try:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS provider_ownership ("
                "provider_id TEXT PRIMARY KEY, verified_at REAL NOT NULL, "
                "verified_at_iso TEXT NOT NULL, source TEXT NOT NULL, owned_app_ids TEXT NOT NULL)"
            )
            connection.execute(
                "CREATE TABLE IF NOT EXISTS provider_scan_attempt ("
                "provider_id TEXT PRIMARY KEY, attempted_at REAL NOT NULL, "
                "status TEXT NOT NULL, complete INTEGER NOT NULL, error TEXT)"
            )
            for scan in scans:
                provider_id = str(scan.get("provider_id") or "").strip()
                if not provider_id:
                    continue
                attempted += 1
                status = str(scan.get("status") or "unknown")
                complete = bool(scan.get("complete"))
                error_row = errors.get(provider_id) or {}
                error = str(error_row.get("error") or "")[:500] or None
                connection.execute(
                    "INSERT INTO provider_scan_attempt VALUES (?, ?, ?, ?, ?) "
                    "ON CONFLICT(provider_id) DO UPDATE SET "
                    "attempted_at=excluded.attempted_at, status=excluded.status, "
                    "complete=excluded.complete, error=excluded.error "
                    "WHERE excluded.attempted_at >= provider_scan_attempt.attempted_at",
                    (provider_id, stamp, status, int(complete), error),
                )
                if status != "ok" or not complete:
                    continue
                account = accounts.get(provider_id)
                if account is None:
                    continue
                connection.execute(
                    "INSERT INTO provider_ownership VALUES (?, ?, ?, ?, ?) "
                    "ON CONFLICT(provider_id) DO UPDATE SET "
                    "verified_at=excluded.verified_at, verified_at_iso=excluded.verified_at_iso, "
                    "source=excluded.source, owned_app_ids=excluded.owned_app_ids "
                    "WHERE excluded.verified_at >= provider_ownership.verified_at",
                    (
                        provider_id,
                        stamp,
                        verified_at,
                        source,
                        json.dumps(_app_ids(account), separators=(",", ":")),
                    ),
                )
                promoted += 1
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return {"attempted": attempted, "promoted": promoted}

    def states(self) -> dict[str, dict[str, Any]]:
        """Return last verified ownership plus latest operational scan status."""
        if not self.path.is_file():
            return {}
        connection = sqlite3.connect(self.path, timeout=30)
        try:
            ownership = {
                row[0]: {
                    "owned_app_ids": set(json.loads(row[4])),
                    "inventory_complete": True,
                    "ownership_verified_at": row[2],
                    "ownership_source": row[3],
                }
                for row in connection.execute(
                    "SELECT provider_id, verified_at, verified_at_iso, source, owned_app_ids "
                    "FROM provider_ownership"
                )
            }
            attempts = {
                row[0]: {
                    "scan_status": row[2],
                    "scan_error": row[4],
                }
                for row in connection.execute(
                    "SELECT provider_id, attempted_at, status, complete, error "
                    "FROM provider_scan_attempt"
                )
            }
        finally:
            connection.close()

        result: dict[str, dict[str, Any]] = {}
        for provider_id in sorted(set(ownership) | set(attempts)):
            state = ownership.get(provider_id) or {
                "owned_app_ids": set(),
                "inventory_complete": False,
                "ownership_verified_at": None,
                "ownership_source": "unverified",
            }
            result[provider_id] = {**state, **attempts.get(provider_id, {})}
            result[provider_id].setdefault("scan_status", "not_scanned")
            result[provider_id].setdefault("scan_error", None)
        return result
