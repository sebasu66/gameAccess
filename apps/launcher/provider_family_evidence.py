"""Cumulative verified family evidence, serialized across local scan workers.

The sidecar contains only whitelisted inventory fields, never login credentials.
It is not a replacement for the complete-scan file and does not claim full coverage.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

FIELDS = (
    "provider_id",
    "owned_app_ids",
    "accessible_app_ids",
    "scan_status",
    "family_key",
    "family_member_provider_ids",
)


def _stamp(snapshot):
    try:
        value = datetime.fromisoformat(str(snapshot.get("verified_at") or ""))
    except ValueError:
        return None
    if value.tzinfo is None:
        return None
    return value.astimezone(timezone.utc).timestamp()


def _successful_rows(snapshot, selected=None):
    stamp = _stamp(snapshot)
    if stamp is None:
        return []
    scans = {
        str(row.get("provider_id")): row
        for row in snapshot.get("scans") or []
        if isinstance(row, dict)
    }
    result = []
    for row in snapshot.get("accounts") or []:
        if not isinstance(row, dict) or row.get("scan_status") != "ok":
            continue
        provider = str(row.get("provider_id") or "")
        if not provider or (selected is not None and provider not in selected):
            continue
        scan = scans.get(provider)
        if not _complete(scan, snapshot):
            continue
        evidence = {key: row[key] for key in FIELDS if key in row}
        evidence["verified_at"] = snapshot["verified_at"]
        if scan and scan.get("family_error"):
            # Query failure must not become confirmed standalone membership.
            evidence["family_key"] = ""
            evidence["family_member_provider_ids"] = []
            evidence["family_status"] = "unknown"
        result.append((provider, stamp, json.dumps(evidence, sort_keys=True)))
    return result


def _complete(scan, snapshot):
    if scan is not None:
        return scan.get("status") == "ok" and scan.get("complete") is True
    # Compatibility for an older genuinely complete authoritative snapshot.
    return snapshot.get("complete") is True


def merge_family_evidence(
    baseline: dict,
    fresh: dict,
    path: Path,
    *,
    selected: set[str] | None = None,
) -> dict:
    """Merge complete successes by per-account timestamp, in one transaction.

    Failed, partial and not-scanned rows cannot erase last verified ownership.
    Call only for snapshots whose ownership sync is intended by the caller.
    Full baseline is seeded on each call but cannot overwrite newer evidence.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=30)
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "CREATE TABLE IF NOT EXISTS provider_evidence ("
            "provider_id TEXT PRIMARY KEY, verified_at REAL NOT NULL, "
            "payload TEXT NOT NULL)"
        )
        rows = _successful_rows(baseline) + _successful_rows(fresh, selected)
        connection.executemany(
            "INSERT INTO provider_evidence VALUES (?, ?, ?) "
            "ON CONFLICT(provider_id) DO UPDATE SET "
            "verified_at=excluded.verified_at, payload=excluded.payload "
            "WHERE excluded.verified_at > provider_evidence.verified_at",
            rows,
        )
        accounts = [
            json.loads(row[0])
            for row in connection.execute(
                "SELECT payload FROM provider_evidence ORDER BY provider_id"
            )
        ]
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return {
        "source": "cumulative-verified-family-evidence",
        "complete": False,
        "accounts": accounts,
    }
