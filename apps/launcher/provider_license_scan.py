"""Authoritative GameAccess provider license scan via SteamKit.

Credentials are loaded locally from ``cuentas.txt`` and passed to the SteamKit
child process through environment variables. They never appear in argv,
stdout, the persisted inventory, or Git. Each provider scan receives a stable
GameAccess LoginID so the headless connection can coexist with other Steam
connections on the same machine when Steam permits it.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from provider_roster import load_provider_credentials, match_provider_identities

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCANNER_PROJECT = PROJECT_ROOT / "tools" / "steamkit-license-scanner" / "SteamKitLicenseScanner.csproj"
SCANNER_DLL = PROJECT_ROOT / "tools" / "steamkit-license-scanner" / "bin" / "Debug" / "net10.0" / "SteamKitLicenseScanner.dll"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / ".gameaccess" / "provider_licenses.json"
LOGIN_ID_BASE = 0x47410000  # "GA" namespace; low bits are provider slot.


def ensure_scanner_built() -> None:
    if SCANNER_DLL.is_file():
        return
    completed = subprocess.run(
        ["dotnet", "build", str(SCANNER_PROJECT)],
        cwd=PROJECT_ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=180,
    )
    if completed.returncode != 0 or not SCANNER_DLL.is_file():
        detail = (completed.stderr or completed.stdout or "dotnet build failed").strip()
        raise RuntimeError(detail[-4000:])


def _login_id_for_provider(provider_id: str) -> int:
    try:
        slot = int(provider_id.rsplit("-", 1)[-1])
    except (TypeError, ValueError):
        slot = 1
    slot = max(1, min(slot, 0xFFFF))
    return LOGIN_ID_BASE + slot


def _run_provider(
    login: str,
    password: str,
    *,
    login_id: int,
    timeout_seconds: int = 70,
) -> dict[str, Any]:
    env = os.environ.copy()
    env["GA_STEAM_USER"] = login
    env["GA_STEAM_PASS"] = password
    env["GA_STEAM_LOGIN_ID"] = str(login_id)
    env["GA_STEAM_TIMEOUT_SECONDS"] = str(max(10, min(timeout_seconds - 5, 180)))
    completed = subprocess.run(
        ["dotnet", str(SCANNER_DLL)],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout_seconds,
    )
    raw = completed.stdout.strip().splitlines()
    if not raw:
        return {
            "status": "scanner_error",
            "exit_code": completed.returncode,
            "error": (completed.stderr or "SteamKit scanner returned no JSON").strip()[-2000:],
            "login_id": login_id,
        }
    try:
        payload = json.loads(raw[-1])
    except json.JSONDecodeError:
        return {
            "status": "scanner_error",
            "exit_code": completed.returncode,
            "error": "SteamKit scanner returned invalid JSON",
            "login_id": login_id,
        }
    if not isinstance(payload, dict):
        return {
            "status": "scanner_error",
            "exit_code": completed.returncode,
            "error": "Invalid scanner payload",
            "login_id": login_id,
        }
    payload["exit_code"] = completed.returncode
    payload.setdefault("login_id", login_id)
    return payload


def scan_provider_licenses(
    *,
    provider_ids: set[str] | None = None,
    timeout_seconds: int = 70,
) -> dict[str, Any]:
    ensure_scanner_built()
    credentials = load_provider_credentials()
    mapping = match_provider_identities()
    identities = {item["provider_id"]: item for item in mapping.get("accounts", [])}
    owner_provider_by_user32 = {
        int(item["user_id32"]): item["provider_id"]
        for item in mapping.get("accounts", [])
        if isinstance(item.get("user_id32"), int)
    }

    selected = [
        credential
        for credential in credentials
        if provider_ids is None or credential.provider_id in provider_ids
    ]
    scans: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    owned_by_provider: dict[str, set[int]] = {credential.provider_id: set() for credential in credentials}
    unmapped_owner_ids: set[int] = set()

    for credential in selected:
        login_id = _login_id_for_provider(credential.provider_id)
        result = _run_provider(
            credential.login,
            credential.password,
            login_id=login_id,
            timeout_seconds=timeout_seconds,
        )
        status = str(result.get("status") or "error")
        packages = result.get("packages") if isinstance(result.get("packages"), list) else []
        scan_summary = {
            "provider_id": credential.provider_id,
            "login_id": int(result.get("login_id") or login_id),
            "status": status,
            "complete": bool(result.get("complete")),
            "license_count": int(result.get("license_count") or 0),
            "package_info_resolved_count": int(result.get("package_info_resolved_count") or 0),
            "borrowed_package_count": int(result.get("borrowed_package_count") or 0),
            "non_permanent_package_count": int(result.get("non_permanent_package_count") or 0),
            "preferred_owner_package_count": int(result.get("preferred_owner_package_count") or 0),
            "missing_package_info_count": len(result.get("missing_package_info") or []),
            "unknown_package_count": len(result.get("unknown_package_ids") or []),
        }
        scans.append(scan_summary)
        if status != "ok":
            errors.append(
                {
                    "provider_id": credential.provider_id,
                    "login_id": int(result.get("login_id") or login_id),
                    "status": status,
                    "error": str(result.get("error") or result.get("result") or status)[:500],
                    "guard_method": result.get("guard_method"),
                }
            )
            continue

        for package in packages:
            if not isinstance(package, dict) or package.get("non_permanent"):
                continue
            app_ids = {
                int(app_id)
                for app_id in package.get("app_ids") or []
                if str(app_id).isdigit() and int(app_id) > 0
            }
            if not app_ids:
                continue
            owner_id = package.get("owner_account_id")
            owner_provider = owner_provider_by_user32.get(int(owner_id)) if isinstance(owner_id, int) and owner_id > 0 else None
            if owner_provider is None and not package.get("borrowed"):
                owner_provider = credential.provider_id
            if owner_provider is None:
                if isinstance(owner_id, int) and owner_id > 0:
                    unmapped_owner_ids.add(owner_id)
                continue
            owned_by_provider.setdefault(owner_provider, set()).update(app_ids)

    scanned_ids = {scan["provider_id"] for scan in scans}
    all_provider_ids = {credential.provider_id for credential in credentials}
    full_coverage = scanned_ids == all_provider_ids
    scans_complete = bool(scans) and all(scan["status"] == "ok" and scan["complete"] for scan in scans)
    complete = full_coverage and scans_complete and not errors

    accounts = [
        {
            "provider_id": credential.provider_id,
            "owned_app_ids": sorted(owned_by_provider.get(credential.provider_id, set())),
            "scan_status": next((scan["status"] for scan in scans if scan["provider_id"] == credential.provider_id), "not_scanned"),
        }
        for credential in credentials
    ]
    return {
        "source": "steamkit-license-list-pics",
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "complete": complete,
        "full_coverage": full_coverage,
        "roster_count": len(credentials),
        "scanned_provider_count": len(scanned_ids),
        "successful_scan_count": sum(1 for scan in scans if scan["status"] == "ok"),
        "error_count": len(errors),
        "unmapped_owner_count": len(unmapped_owner_ids),
        "accounts": accounts,
        "scans": scans,
        "errors": errors,
    }


def load_provider_license_inventory(path: Path = DEFAULT_OUTPUT) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def save_provider_license_inventory(inventory: dict[str, Any], path: Path = DEFAULT_OUTPUT) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")


def compact_inventory(inventory: dict[str, Any]) -> dict[str, Any]:
    return {
        key: inventory.get(key)
        for key in (
            "source",
            "verified_at",
            "complete",
            "full_coverage",
            "roster_count",
            "scanned_provider_count",
            "successful_scan_count",
            "error_count",
            "unmapped_owner_count",
        )
    } | {
        "scans": inventory.get("scans", []),
        "errors": inventory.get("errors", []),
        "accounts": [
            {
                "provider_id": account["provider_id"],
                "owned_game_count": len(account.get("owned_app_ids") or []),
                "scan_status": account.get("scan_status"),
            }
            for account in inventory.get("accounts", [])
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan Steam provider licenses with headless SteamKit")
    parser.add_argument("--provider-id", action="append", default=[], help="scan only this opaque provider id; may be repeated")
    parser.add_argument("--all", action="store_true", help="scan the entire provider roster")
    parser.add_argument("--timeout-seconds", type=int, default=70)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()

    if args.all and args.provider_id:
        parser.error("use either --all or --provider-id, not both")
    if not args.all and not args.provider_id:
        parser.error("select --all or at least one --provider-id")

    selected = None if args.all else set(args.provider_id)
    inventory = scan_provider_licenses(provider_ids=selected, timeout_seconds=args.timeout_seconds)
    save_provider_license_inventory(inventory, args.output)
    print(json.dumps(compact_inventory(inventory) if args.compact else inventory, ensure_ascii=False))
    if inventory.get("complete"):
        return 0
    return 2 if inventory.get("successful_scan_count") else 3


if __name__ == "__main__":
    raise SystemExit(main())
