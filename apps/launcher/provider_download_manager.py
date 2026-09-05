"""Run GameAccess provider downloads without consulting personal Steam licenses.

The desktop uses this manager only for the ``gameaccess`` catalog. It selects a
provider from the same best-known SteamKit ownership state used by backend pool
sync, delegates the CDN transfer to ``provider_download_probe.py``, and then
prepares the downloaded files for Steam's supported existing-files discovery
flow.

Provider passwords remain inside the existing roster/downloader boundary. This
module persists only opaque provider ids, AppIDs, byte counts, state, job
identity and a sanitized error message for the desktop status bridge.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from provider_download_probe import provider_candidates, run_probe, verified_provider_ids_for_app
from provider_inventory import build_provider_catalog
from provider_license_scan import persist_scan_result, scan_provider_licenses
from steam_prepare_import import inspect, prepare

RUNTIME_ROOT = Path(__file__).resolve().parent / ".gameaccess"
STATUS_ROOT = RUNTIME_ROOT / "downloads" / "status"
LOG_ROOT = RUNTIME_ROOT / "downloads" / "logs"
ACTIVE_STATES = {"requested", "preparing", "downloading", "paused", "cancelling"}


def status_path(app_id: int) -> Path:
    return STATUS_ROOT / f"app-{app_id}.json"


def log_path(app_id: int) -> Path:
    return LOG_ROOT / f"app-{app_id}.jsonl"


def _append_status_log(body: dict[str, Any]) -> None:
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    entry = {"at": datetime.now(timezone.utc).isoformat(), **body}
    with log_path(int(body["app_id"])).open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=True) + "
")


def write_status(app_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    STATUS_ROOT.mkdir(parents=True, exist_ok=True)
    body = {
        "app_id": app_id,
        "state": str(payload.get("state") or "unknown"),
        "progress": payload.get("progress"),
        "bytes_downloaded": payload.get("bytes_downloaded"),
        "bytes_total": payload.get("bytes_total"),
        "speed_bps": payload.get("speed_bps"),
        "eta_seconds": payload.get("eta_seconds"),
        "installed": bool(payload.get("installed")),
        "provider_id": payload.get("provider_id"),
        "prepared_target": payload.get("prepared_target"),
        "error": payload.get("error"),
        "job_id": payload.get("job_id"),
        "worker_pid": payload.get("worker_pid"),
    }
    target = status_path(app_id)
    previous: dict[str, Any] = {}
    if target.is_file():
        try:
            value = json.loads(target.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                previous = value
        except (OSError, json.JSONDecodeError):
            pass
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(body, ensure_ascii=True), encoding="utf-8")
    temp.replace(target)
    transition_keys = ("state", "error", "job_id", "provider_id", "prepared_target")
    if not previous or any(previous.get(key) != body.get(key) for key in transition_keys):
        _append_status_log(body)
    return body


def read_status(app_id: int) -> dict[str, Any] | None:
    target = status_path(app_id)
    if not target.is_file():
        return None
    try:
        value = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def cancellation_requested(app_id: int, job_id: str) -> bool:
    current = read_status(app_id)
    return bool(current and current.get("job_id") == job_id and current.get("state") == "cancelling")


def cancelled_status(app_id: int, job_id: str, provider_id: str | None, previous: dict[str, Any] | None = None) -> dict[str, Any]:
    previous = previous or read_status(app_id) or {}
    return write_status(app_id, {
        **previous,
        "state": "cancelled",
        "installed": False,
        "speed_bps": None,
        "eta_seconds": None,
        "provider_id": provider_id or previous.get("provider_id"),
        "error": None,
        "job_id": job_id,
        "worker_pid": None,
    })


def _scan_owned_provider_ids(inventory: dict[str, Any], app_id: int) -> list[str]:
    owners: list[str] = []
    for account in inventory.get("accounts", []):
        if not isinstance(account, dict):
            continue
        owned = {int(value) for value in account.get("owned_app_ids") or [] if str(value).isdigit() and int(value) > 0}
        provider_id = str(account.get("provider_id") or "").strip()
        if provider_id and app_id in owned:
            owners.append(provider_id)
    return sorted(set(owners))


def _cached_access_provider_ids(app_id: int) -> list[str]:
    catalog = build_provider_catalog()
    providers = []
    for account in catalog.get("accounts", []):
        if not isinstance(account, dict):
            continue
        accessible = {int(value) for value in account.get("accessible_app_ids") or [] if str(value).isdigit() and int(value) > 0}
        provider_id = str(account.get("provider_id") or "").strip()
        if provider_id and app_id in accessible:
            providers.append(provider_id)
    return sorted(set(providers))


def refresh_original_owner_for_app(app_id: int) -> str:
    candidates = _cached_access_provider_ids(app_id)
    if not candidates:
        raise RuntimeError(f"GameAccess no encontró ninguna cuenta proveedora con AppID {app_id} en el catálogo local.")
    errors: list[str] = []
    for candidate in candidates:
        try:
            scan = scan_provider_licenses(provider_ids={candidate})
            owners = _scan_owned_provider_ids(scan, app_id)
            if not owners:
                errors.append(f"{candidate}: sin propietario original")
                continue
            for owner in owners:
                owner_scan = scan if owner == candidate else scan_provider_licenses(provider_ids={owner})
                confirmed = _scan_owned_provider_ids(owner_scan, app_id)
                if owner not in confirmed:
                    errors.append(f"{owner}: no confirmó propiedad directa")
                    continue
                persist_scan_result(owner_scan)
                return owner
        except Exception as exc:
            errors.append(f"{candidate}: {exc}")
    detail = "; ".join(errors[:4])
    raise RuntimeError(f"GameAccess no pudo verificar la cuenta propietaria original de AppID {app_id}." + (f" ({detail})" if detail else ""))


def verified_provider_for_app(app_id: int) -> str:
    owners = verified_provider_ids_for_app(app_id)
    if not owners:
        raise RuntimeError(f"GameAccess no encontró una licencia SteamKit verificada para AppID {app_id}.")
    errors: list[str] = []
    for provider_id in owners:
        try:
            if any(item["app_id"] == app_id for item in provider_candidates(provider_id)):
                return provider_id
        except Exception as exc:
            errors.append(f"{provider_id}: {exc}")
    detail = "; ".join(errors[:3])
    raise RuntimeError(f"La licencia existe, pero el catálogo local no puede preparar AppID {app_id}" + (f" ({detail})" if detail else ""))


def validation_result(app_id: int) -> dict[str, Any]:
    provider_id = refresh_original_owner_for_app(app_id)
    return {"ok": True, "app_id": app_id, "provider_id": provider_id}


def _prepared_library(state: dict[str, Any]) -> dict[str, Any] | None:
    source_bytes = int(state.get("source_bytes") or 0)
    candidates = [item for item in state.get("libraries", []) if isinstance(item, dict) and not item.get("manifest_exists") and (item.get("free_bytes") is None or int(item["free_bytes"]) >= source_bytes)]
    return min(candidates, key=lambda item: int(item.get("index") or 0)) if candidates else None


def estimate_download(app_id: int, provider_id: str) -> dict[str, Any]:
    result = run_probe(provider_id, app_id, manifest_only=True, download=False, timeout_seconds=10 * 60)
    if not result.get("ok"):
        detail = str(result.get("stderr_tail") or result.get("stdout_tail") or "")[-1000:]
        raise RuntimeError(detail or "No se pudo calcular el tamaño de descarga")
    total = int(result.get("total_bytes") or 0)
    return {"ok": True, "app_id": app_id, "provider_id": provider_id, "bytes_total": total or None, "depot_totals": result.get("depot_totals") or {}}


def run_download(app_id: int, provider_id: str | None, job_id: str) -> dict[str, Any]:
    current = read_status(app_id)
    if current and str(current.get("state")) in ACTIVE_STATES and current.get("job_id") not in {None, job_id}:
        return current
    worker_pid = os.getpid()
    write_status(app_id, {"state": "preparing", "progress": 0.0, "bytes_downloaded": 0, "bytes_total": None, "speed_bps": None, "eta_seconds": None, "installed": False, "provider_id": provider_id, "job_id": job_id, "worker_pid": worker_pid})
    try:
        if cancellation_requested(app_id, job_id):
            return cancelled_status(app_id, job_id, provider_id)
        if not provider_id:
            provider_id = refresh_original_owner_for_app(app_id)
            write_status(app_id, {"state": "preparing", "progress": 0.0, "bytes_downloaded": 0, "bytes_total": None, "speed_bps": None, "eta_seconds": None, "installed": False, "provider_id": provider_id, "job_id": job_id, "worker_pid": worker_pid})
        if cancellation_requested(app_id, job_id):
            return cancelled_status(app_id, job_id, provider_id)

        estimate = estimate_download(app_id, provider_id)
        if cancellation_requested(app_id, job_id):
            return cancelled_status(app_id, job_id, provider_id)
        depot_totals = {str(key): int(value) for key, value in (estimate.get("depot_totals") or {}).items() if str(value).isdigit() and int(value) > 0}
        total = int(estimate.get("bytes_total") or 0)
        write_status(app_id, {"state": "preparing", "progress": 0.0, "bytes_downloaded": 0, "bytes_total": total or None, "speed_bps": None, "eta_seconds": None, "installed": False, "provider_id": provider_id, "job_id": job_id, "worker_pid": worker_pid})

        current_depot = None
        depot_progress = {key: 0.0 for key in depot_totals}
        started_at = time.monotonic()
        last_write = 0.0

        def on_output(line: str) -> None:
            nonlocal current_depot, last_write
            if cancellation_requested(app_id, job_id):
                return
            depot = re.search(r"Downloading depot\s+(\d+)", line)
            if depot:
                current_depot = depot.group(1)
                return
            match = re.match(r"\s*(\d+(?:\.\d+)?)%\s+", line)
            if not match:
                return
            pct = max(0.0, min(100.0, float(match.group(1))))
            if current_depot and current_depot in depot_progress:
                depot_progress[current_depot] = max(depot_progress[current_depot], pct)
            if total > 0 and depot_totals:
                downloaded = int(sum(depot_totals[key] * depot_progress.get(key, 0.0) / 100.0 for key in depot_totals))
                overall = downloaded / total * 100.0
            else:
                downloaded = 0
                overall = pct
            elapsed = max(.001, time.monotonic() - started_at)
            speed = downloaded / elapsed if downloaded > 0 else None
            eta = (total - downloaded) / speed if speed and total > downloaded else None
            now = time.monotonic()
            if now - last_write < .35 and overall < 100:
                return
            last_write = now
            write_status(app_id, {"state": "downloading", "progress": overall, "bytes_downloaded": downloaded or None, "bytes_total": total or None, "speed_bps": int(speed) if speed else None, "eta_seconds": int(eta) if eta else None, "installed": False, "provider_id": provider_id, "job_id": job_id, "worker_pid": worker_pid})

        result = run_probe(provider_id, app_id, manifest_only=False, download=True, timeout_seconds=6 * 60 * 60, progress_callback=on_output)
        if cancellation_requested(app_id, job_id):
            return cancelled_status(app_id, job_id, provider_id)
        if not result.get("ok"):
            detail = str(result.get("stderr_tail") or result.get("stdout_tail") or "")[-1000:]
            raise RuntimeError(detail or "DepotDownloader no pudo completar la descarga")

        state = inspect(app_id, provider_id)
        existing = next((item for item in state.get("libraries", []) if item.get("manifest_exists")), None)
        if existing:
            target = str(existing.get("target") or "")
        else:
            if cancellation_requested(app_id, job_id):
                return cancelled_status(app_id, job_id, provider_id)
            library = _prepared_library(state)
            if library is None:
                raise RuntimeError("No hay una biblioteca Steam con espacio suficiente para preparar la descarga.")
            prepared = prepare(app_id, provider_id, int(library["index"]))
            if not prepared.get("ok") or not prepared.get("prepared"):
                raise RuntimeError(str(prepared.get("reason") or "No se pudieron preparar los archivos para Steam"))
            target = str(prepared.get("target") or "")

        final_total = int(state.get("source_bytes") or result.get("total_bytes") or total or 0)
        # Completion wins over a late cancellation request once preparation has
        # produced a validated install target.
        return write_status(app_id, {"state": "prepared", "progress": 100.0, "bytes_downloaded": final_total or None, "bytes_total": final_total or None, "speed_bps": None, "eta_seconds": 0, "installed": False, "provider_id": provider_id, "prepared_target": target, "job_id": job_id, "worker_pid": None})
    except Exception as exc:
        if cancellation_requested(app_id, job_id):
            return cancelled_status(app_id, job_id, provider_id)
        return write_status(app_id, {"state": "not-installed", "progress": None, "bytes_downloaded": None, "bytes_total": None, "speed_bps": None, "eta_seconds": None, "installed": False, "provider_id": provider_id, "error": str(exc)[:1200], "job_id": job_id, "worker_pid": None})


def _print(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="GameAccess provider download manager")
    parser.add_argument("--app-id", type=int, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate", action="store_true")
    mode.add_argument("--estimate", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--provider-id")
    parser.add_argument("--job-id")
    args = parser.parse_args()

    if args.validate:
        try:
            _print(validation_result(args.app_id))
            return 0
        except Exception as exc:
            _print({"ok": False, "app_id": args.app_id, "error": str(exc)[:1200]})
            return 2

    provider_id = str(args.provider_id or "").strip() or None
    if args.estimate:
        try:
            resolved = provider_id or verified_provider_for_app(args.app_id)
            _print(estimate_download(args.app_id, resolved))
            return 0
        except Exception as exc:
            _print({"ok": False, "app_id": args.app_id, "provider_id": provider_id, "error": str(exc)[:1200]})
            return 2

    job_id = str(args.job_id or "").strip()
    if not job_id:
        _print({"ok": False, "app_id": args.app_id, "error": "--job-id is required for managed downloads"})
        return 2
    result = run_download(args.app_id, provider_id, job_id)
    _print(result)
    if result.get("installed") or result.get("state") == "prepared":
        return 0
    return 3 if result.get("state") == "cancelled" else 2


if __name__ == "__main__":
    raise SystemExit(main())
