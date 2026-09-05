"""Run GameAccess provider downloads without consulting personal Steam licenses.

The desktop uses this manager only for the ``gameaccess`` catalog. It selects a
provider from the same best-known SteamKit ownership state used by backend pool
sync, delegates the CDN transfer to ``provider_download_probe.py``, and then
prepares the downloaded files for Steam's supported existing-files discovery
flow.

Provider passwords remain inside the existing roster/downloader boundary. This
module persists only opaque provider ids, AppIDs, byte counts, state, and a
sanitized error message for the desktop status bridge.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from provider_download_probe import (
    provider_candidates,
    run_probe,
    verified_provider_ids_for_app,
)
from steam_prepare_import import inspect, prepare

RUNTIME_ROOT = Path(__file__).resolve().parent / ".gameaccess"
STATUS_ROOT = RUNTIME_ROOT / "downloads" / "status"
ACTIVE_STATES = {"requested", "preparing", "downloading", "paused"}


def status_path(app_id: int) -> Path:
    return STATUS_ROOT / f"app-{app_id}.json"


def write_status(app_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    STATUS_ROOT.mkdir(parents=True, exist_ok=True)
    body = {
        "app_id": app_id,
        "state": str(payload.get("state") or "unknown"),
        "progress": payload.get("progress"),
        "bytes_downloaded": payload.get("bytes_downloaded"),
        "bytes_total": payload.get("bytes_total"),
        "installed": bool(payload.get("installed")),
        "provider_id": payload.get("provider_id"),
        "prepared_target": payload.get("prepared_target"),
        "error": payload.get("error"),
    }
    target = status_path(app_id)
    temp = target.with_suffix(".tmp")
    temp.write_text(json.dumps(body, ensure_ascii=True), encoding="utf-8")
    temp.replace(target)
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


def verified_provider_for_app(app_id: int) -> str:
    owners = verified_provider_ids_for_app(app_id)
    if not owners:
        raise RuntimeError(
            f"GameAccess no encontró una licencia SteamKit verificada para AppID {app_id}."
        )

    errors: list[str] = []
    for provider_id in owners:
        try:
            if any(item["app_id"] == app_id for item in provider_candidates(provider_id)):
                return provider_id
        except Exception as exc:  # validation must try the remaining verified owners
            errors.append(f"{provider_id}: {exc}")

    detail = "; ".join(errors[:3])
    suffix = f" ({detail})" if detail else ""
    raise RuntimeError(
        f"La licencia existe, pero el catálogo local no puede preparar AppID {app_id}{suffix}."
    )


def validation_result(app_id: int) -> dict[str, Any]:
    provider_id = verified_provider_for_app(app_id)
    return {"ok": True, "app_id": app_id, "provider_id": provider_id}


def _prepared_library(state: dict[str, Any]) -> dict[str, Any] | None:
    source_bytes = int(state.get("source_bytes") or 0)
    candidates = [
        item
        for item in state.get("libraries", [])
        if isinstance(item, dict)
        and not item.get("manifest_exists")
        and (item.get("free_bytes") is None or int(item["free_bytes"]) >= source_bytes)
    ]
    return min(candidates, key=lambda item: int(item.get("index") or 0)) if candidates else None


def run_download(app_id: int, provider_id: str) -> dict[str, Any]:
    current = read_status(app_id)
    if current and str(current.get("state")) in ACTIVE_STATES:
        return current

    write_status(
        app_id,
        {
            "state": "preparing",
            "progress": None,
            "bytes_downloaded": None,
            "bytes_total": None,
            "installed": False,
            "provider_id": provider_id,
        },
    )

    try:
        result = run_probe(
            provider_id,
            app_id,
            manifest_only=False,
            download=True,
            timeout_seconds=6 * 60 * 60,
        )
        if not result.get("ok"):
            detail = str(result.get("stderr_tail") or result.get("stdout_tail") or "")[-1000:]
            raise RuntimeError(detail or "DepotDownloader no pudo completar la descarga")

        state = inspect(app_id, provider_id)
        existing = next(
            (item for item in state.get("libraries", []) if item.get("manifest_exists")),
            None,
        )
        if existing:
            target = str(existing.get("target") or "")
        else:
            library = _prepared_library(state)
            if library is None:
                raise RuntimeError(
                    "No hay una biblioteca Steam con espacio suficiente para preparar la descarga."
                )
            prepared = prepare(app_id, provider_id, int(library["index"]))
            if not prepared.get("ok") or not prepared.get("prepared"):
                raise RuntimeError(
                    str(prepared.get("reason") or "No se pudieron preparar los archivos para Steam")
                )
            target = str(prepared.get("target") or "")

        total = int(state.get("source_bytes") or result.get("total_bytes") or 0)
        return write_status(
            app_id,
            {
                "state": "installed",
                "progress": 100.0,
                "bytes_downloaded": total or None,
                "bytes_total": total or None,
                "installed": True,
                "provider_id": provider_id,
                "prepared_target": target,
            },
        )
    except Exception as exc:
        return write_status(
            app_id,
            {
                "state": "not-installed",
                "progress": None,
                "bytes_downloaded": None,
                "bytes_total": None,
                "installed": False,
                "provider_id": provider_id,
                "error": str(exc)[:1200],
            },
        )


def _print(value: dict[str, Any]) -> None:
    print(json.dumps(value, ensure_ascii=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="GameAccess provider download manager")
    parser.add_argument("--app-id", type=int, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--validate", action="store_true")
    mode.add_argument("--run", action="store_true")
    parser.add_argument("--provider-id")
    args = parser.parse_args()

    if args.validate:
        try:
            _print(validation_result(args.app_id))
            return 0
        except Exception as exc:
            _print({"ok": False, "app_id": args.app_id, "error": str(exc)[:1200]})
            return 2

    provider_id = str(args.provider_id or "").strip()
    if not provider_id:
        try:
            provider_id = verified_provider_for_app(args.app_id)
        except Exception as exc:
            _print({"ok": False, "app_id": args.app_id, "error": str(exc)[:1200]})
            return 2

    result = run_download(args.app_id, provider_id)
    _print(result)
    return 0 if result.get("installed") else 2


if __name__ == "__main__":
    raise SystemExit(main())
