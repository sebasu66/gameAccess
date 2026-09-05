"""Authoritative GameAccess provider license scan via SteamKit.

Credentials are loaded locally from ``cuentas.txt`` and passed to the SteamKit
child process through environment variables. They never appear in argv,
stdout, the persisted inventory, or Git. Each provider scan receives a stable
GameAccess LoginID so the headless connection can coexist with other Steam
connections on the same machine when Steam permits it.

Only a complete full-roster scan may replace the default authoritative
``provider_licenses.json`` snapshot. Partial/failed scans are written to a
separate diagnostic snapshot so test batches can never erase known ownership.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from provider_roster import load_provider_credentials, match_provider_identities

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCANNER_PROJECT = PROJECT_ROOT / "tools" / "steamkit-license-scanner" / "SteamKitLicenseScanner.csproj"
SCANNER_SOURCE = PROJECT_ROOT / "tools" / "steamkit-license-scanner" / "Program.cs"
SCANNER_DLL = PROJECT_ROOT / "tools" / "steamkit-license-scanner" / "bin" / "Debug" / "net10.0" / "SteamKitLicenseScanner.dll"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / ".gameaccess" / "provider_licenses.json"
DEFAULT_DIAGNOSTIC_OUTPUT = Path(__file__).resolve().parent / ".gameaccess" / "provider_licenses.last_scan.json"
LOGIN_ID_BASE = 0x47410000  # "GA" namespace; low bits are provider slot.


def ensure_scanner_built() -> None:
    source_mtime = max(
        SCANNER_PROJECT.stat().st_mtime if SCANNER_PROJECT.is_file() else 0,
        SCANNER_SOURCE.stat().st_mtime if SCANNER_SOURCE.is_file() else 0,
    )
    if SCANNER_DLL.is_file() and SCANNER_DLL.stat().st_mtime >= source_mtime:
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


STEAM_ID64_ACCOUNT_BASE = 76561197960265728


def _account_id32_from_steam64(steam_id64: str | int | None) -> int | None:
    try:
        value = int(steam_id64 or 0)
    except (TypeError, ValueError):
        return None
    account_id = value - STEAM_ID64_ACCOUNT_BASE
    return account_id if account_id > 0 else None


def _resolve_original_owner_provider(
    *,
    current_provider_id: str,
    current_user_id32: int | None,
    owner_account_id: int | None,
    borrowed: bool,
    owner_provider_by_user32: dict[int, str],
) -> str | None:
    """Resolve the permanent/original Steam owner for a package.

    OwnerAccountID is authoritative even when Steam does not set the Borrowed
    flag. A family member must never become a download owner merely because the
    package is visible in their LicenseList.
    """
    owner_id = int(owner_account_id or 0)
    if owner_id > 0:
        if current_user_id32 and owner_id == current_user_id32:
            return current_provider_id
        return owner_provider_by_user32.get(owner_id)
    if borrowed:
        return None
    return current_provider_id


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
    owner_provider_by_user32 = {
        int(item["user_id32"]): item["provider_id"]
        for item in mapping.get("accounts", [])
        if isinstance(item.get("user_id32"), int)
    }
    provider_by_steam64 = {
        str(item["steam_id64"]): item["provider_id"]
        for item in mapping.get("accounts", [])
        if str(item.get("steam_id64") or "").isdigit()
    }

    selected = [
        credential
        for credential in credentials
        if provider_ids is None or credential.provider_id in provider_ids
    ]
    scans: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []
    owned_by_provider: dict[str, set[int]] = {
        credential.provider_id: set() for credential in credentials
    }
    unmapped_owner_ids: set[int] = set()
    family_key_by_provider: dict[str, str] = {}
    family_members_by_provider: dict[str, list[str]] = {}
    scanned_steam64_by_provider: dict[str, str] = {}
    raw_family_member_steam_ids_by_provider: dict[str, list[str]] = {}

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
        family_key = ""
        family_member_provider_ids: list[str] = []
        scanner_user_id32: int | None = None
        if status == "ok":
            scanner_steam64 = str(result.get("steam_id64") or "")
            if scanner_steam64.isdigit():
                provider_by_steam64[scanner_steam64] = credential.provider_id
                scanned_steam64_by_provider[credential.provider_id] = scanner_steam64
                scanner_user_id32 = _account_id32_from_steam64(scanner_steam64)
                if scanner_user_id32:
                    owner_provider_by_user32[scanner_user_id32] = credential.provider_id
            raw_family_id = result.get("family_group_id")
            try:
                family_group_id = int(raw_family_id or 0)
            except (TypeError, ValueError):
                family_group_id = 0
            is_standalone = bool(result.get("is_not_member_of_any_group")) or family_group_id <= 0
            if is_standalone:
                family_key = f"standalone:{credential.provider_id}"
                family_member_provider_ids = [credential.provider_id]
                raw_family_member_steam_ids_by_provider[credential.provider_id] = [scanner_steam64] if scanner_steam64 else []
            else:
                digest = hashlib.sha256(f"steam-family:{family_group_id}".encode("utf-8")).hexdigest()[:24]
                family_key = f"steam-family:{digest}"
                raw_family_member_steam_ids_by_provider[credential.provider_id] = [
                    str(steam_id)
                    for steam_id in result.get("family_member_steam_ids") or []
                    if str(steam_id).isdigit()
                ]
                # Resolve once now for diagnostics; a complete second pass below
                # repeats this after every scanned provider SteamID is known.
                family_member_provider_ids = sorted(
                    {
                        provider_by_steam64[str(steam_id)]
                        for steam_id in raw_family_member_steam_ids_by_provider[credential.provider_id]
                        if str(steam_id) in provider_by_steam64
                    }
                    | {credential.provider_id}
                )
            family_key_by_provider[credential.provider_id] = family_key
            family_members_by_provider[credential.provider_id] = family_member_provider_ids

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
            "family_grouped": bool(family_key and family_key.startswith("steam-family:")),
            "family_member_count": len(family_member_provider_ids),
            "family_error": str(result.get("family_error") or "")[:500] or None,
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
            owner_provider = _resolve_original_owner_provider(
                current_provider_id=credential.provider_id,
                current_user_id32=scanner_user_id32,
                owner_account_id=owner_id if isinstance(owner_id, int) else None,
                borrowed=bool(package.get("borrowed")),
                owner_provider_by_user32=owner_provider_by_user32,
            )
            if owner_provider is None:
                if isinstance(owner_id, int) and owner_id > 0:
                    unmapped_owner_ids.add(owner_id)
                continue
            owned_by_provider.setdefault(owner_provider, set()).update(app_ids)

    # Resolve family members only after all account scans have completed.
    # This avoids missing a sibling merely because its own SteamID was learned
    # later in the scan order. Raw SteamIDs remain local/ephemeral and are not
    # persisted in the inventory.
    final_provider_by_steam64 = dict(provider_by_steam64)
    final_provider_by_steam64.update(
        {steam64: provider_id for provider_id, steam64 in scanned_steam64_by_provider.items()}
    )
    scan_by_provider = {str(scan.get("provider_id")): scan for scan in scans}
    for provider_id, family_key in family_key_by_provider.items():
        if family_key.startswith("standalone:"):
            members = [provider_id]
        else:
            members = sorted(
                {
                    final_provider_by_steam64[steam64]
                    for steam64 in raw_family_member_steam_ids_by_provider.get(provider_id, [])
                    if steam64 in final_provider_by_steam64
                }
                | {provider_id}
            )
        family_members_by_provider[provider_id] = members
        scan = scan_by_provider.get(provider_id)
        if scan is not None:
            scan["family_member_count"] = len(members)

    scanned_ids = {scan["provider_id"] for scan in scans}
    all_provider_ids = {credential.provider_id for credential in credentials}
    full_coverage = scanned_ids == all_provider_ids
    scans_complete = bool(scans) and all(
        scan["status"] == "ok" and scan["complete"] for scan in scans
    )
    complete = full_coverage and scans_complete and not errors

    accounts = [
        {
            "provider_id": credential.provider_id,
            "owned_app_ids": sorted(owned_by_provider.get(credential.provider_id, set())),
            "scan_status": next(
                (
                    scan["status"]
                    for scan in scans
                    if scan["provider_id"] == credential.provider_id
                ),
                "not_scanned",
            ),
            "family_key": family_key_by_provider.get(credential.provider_id, ""),
            "family_member_provider_ids": family_members_by_provider.get(credential.provider_id, []),
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


def load_provider_license_inventory(
    path: Path = DEFAULT_OUTPUT,
    *,
    require_complete: bool = False,
) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if require_complete and not payload.get("complete"):
        return None
    return payload


def _write_inventory(inventory: dict[str, Any], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.tmp")
    temp.write_text(
        json.dumps(inventory, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temp.replace(path)


def save_provider_license_inventory(
    inventory: dict[str, Any],
    path: Path = DEFAULT_OUTPUT,
    *,
    allow_incomplete: bool = False,
) -> bool:
    """Persist an ownership inventory without poisoning the authoritative file.

    ``DEFAULT_OUTPUT`` is authoritative and therefore accepts only a complete
    full-roster scan. Callers may explicitly persist incomplete diagnostics to
    another path using ``allow_incomplete=True``.
    """
    path = Path(path)
    is_authoritative_path = path.resolve() == DEFAULT_OUTPUT.resolve()
    if is_authoritative_path and not inventory.get("complete"):
        return False
    if not inventory.get("complete") and not allow_incomplete:
        return False
    _write_inventory(inventory, path)
    return True


def persist_scan_result(
    inventory: dict[str, Any],
    requested_output: Path | None = None,
) -> dict[str, Any]:
    """Persist a scan to the correct authoritative or diagnostic destination."""
    if inventory.get("complete"):
        target = Path(requested_output) if requested_output else DEFAULT_OUTPUT
        saved = save_provider_license_inventory(inventory, target)
        return {
            "saved": saved,
            "authoritative_updated": bool(
                saved and target.resolve() == DEFAULT_OUTPUT.resolve()
            ),
            "output": str(target),
        }

    requested = Path(requested_output) if requested_output else None
    if requested is None or requested.resolve() == DEFAULT_OUTPUT.resolve():
        target = DEFAULT_DIAGNOSTIC_OUTPUT
    else:
        target = requested
    saved = save_provider_license_inventory(
        inventory,
        target,
        allow_incomplete=True,
    )
    return {
        "saved": saved,
        "authoritative_updated": False,
        "output": str(target),
    }


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
                "family_key": account.get("family_key"),
                "family_member_count": len(account.get("family_member_provider_ids") or []),
            }
            for account in inventory.get("accounts", [])
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scan Steam provider licenses with headless SteamKit"
    )
    parser.add_argument(
        "--provider-id",
        action="append",
        default=[],
        help="scan only this opaque provider id; may be repeated",
    )
    parser.add_argument("--all", action="store_true", help="scan the entire provider roster")
    parser.add_argument("--timeout-seconds", type=int, default=70)
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help=(
            "optional explicit output; incomplete scans never overwrite the "
            "default authoritative provider_licenses.json"
        ),
    )
    parser.add_argument("--compact", action="store_true")
    args = parser.parse_args()

    if args.all and args.provider_id:
        parser.error("use either --all or --provider-id, not both")
    if not args.all and not args.provider_id:
        parser.error("select --all or at least one --provider-id")

    selected = None if args.all else set(args.provider_id)
    inventory = scan_provider_licenses(
        provider_ids=selected,
        timeout_seconds=args.timeout_seconds,
    )
    persistence = persist_scan_result(inventory, args.output)
    rendered = compact_inventory(inventory) if args.compact else dict(inventory)
    rendered["persistence"] = persistence
    print(json.dumps(rendered, ensure_ascii=False))
    if inventory.get("complete"):
        return 0
    return 2 if inventory.get("successful_scan_count") else 3


if __name__ == "__main__":
    raise SystemExit(main())
