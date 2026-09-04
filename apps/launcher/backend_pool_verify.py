"""Verify the local GameAccess backend/provider pool without fresh Steam authentication.

This is intentionally a no-login/no-download verification pass. It uses:
- local Steam metadata for personal/provider classification;
- the existing saved SteamKit ownership snapshot;
- the local FastAPI backend on 127.0.0.1:8000.

It never calls scan_provider_licenses(refresh) and never invokes a download path.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests

from pool_sync import build_game_pool, compact_pool, sync_backend
from provider_inventory import build_provider_catalog, compact_catalog
from steam_pool import scan_pool

ROOT = Path(__file__).resolve().parents[2]
API_DIR = ROOT / "apps" / "api"
API_PYTHON = API_DIR / ".venv" / "Scripts" / "python.exe"
API = "http://127.0.0.1:8000"


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _health() -> dict[str, Any] | None:
    try:
        response = requests.get(f"{API}/health", timeout=2)
        response.raise_for_status()
        data = response.json()
        return data if isinstance(data, dict) and data.get("ok") else None
    except Exception:
        return None


def ensure_backend() -> tuple[dict[str, Any], int | None]:
    health = _health()
    if health:
        return health, None
    if not API_PYTHON.is_file():
        raise RuntimeError(f"API venv Python not found: {API_PYTHON}")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    proc = subprocess.Popen(
        [
            str(API_PYTHON),
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8000",
        ],
        cwd=API_DIR,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    deadline = time.time() + 20
    while time.time() < deadline:
        health = _health()
        if health:
            return health, proc.pid
        if proc.poll() is not None:
            raise RuntimeError(f"Backend exited during startup with code {proc.returncode}")
        time.sleep(0.5)
    raise RuntimeError("Backend health endpoint did not become ready")


def run_api_tests() -> dict[str, Any]:
    if not API_PYTHON.is_file():
        return {"ok": False, "skipped": True, "reason": "api_venv_missing"}
    cp = subprocess.run(
        [str(API_PYTHON), "-m", "pytest", str(API_DIR / "tests"), "-q"],
        cwd=API_DIR,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=120,
        errors="replace",
    )
    return {
        "ok": cp.returncode == 0,
        "exit_code": cp.returncode,
        "stdout_tail": cp.stdout[-2000:],
        "stderr_tail": cp.stderr[-1000:],
    }


def personal_account_summary() -> dict[str, Any]:
    local = scan_pool()
    return {
        "ok": bool(local.get("ok")),
        "remembered_local_account_count": len(local.get("accounts") or []),
        "active_user_present": local.get("active_user_id32") is not None,
        "owned_unique_app_count": int(local.get("unique_app_count") or 0),
        "accessible_app_count": int(local.get("accessible_app_count") or 0),
    }


def provider_summary() -> tuple[dict[str, Any], dict[str, Any]]:
    provider = build_provider_catalog()
    compact = compact_catalog(provider)
    return provider, {
        "ok": bool(compact.get("ok")),
        "roster_count": int(compact.get("roster_count") or 0),
        "matched_identity_count": int(compact.get("matched_identity_count") or 0),
        "missing_identity_count": int(compact.get("missing_identity_count") or 0),
        "all_provider_remember_false": compact.get("all_provider_remember_false"),
        "game_count": int(compact.get("game_count") or 0),
        "accessible_unique_app_count": int(compact.get("accessible_unique_app_count") or 0),
    }


def backend_summary(pool: dict[str, Any]) -> dict[str, Any]:
    backend_sync = sync_backend(pool, API)
    catalog = requests.get(f"{API}/catalog", timeout=30).json()
    admin_accounts = requests.get(f"{API}/admin/accounts", timeout=30).json()
    roster_status = requests.get(f"{API}/admin/pool/roster-status", timeout=10).json()
    if not isinstance(catalog, list):
        raise RuntimeError("Backend /catalog did not return a list")
    if not isinstance(admin_accounts, list):
        raise RuntimeError("Backend /admin/accounts did not return a list")

    states = {"ready": 0, "owned-busy": 0, "unavailable": 0}
    copies_total = 0
    copies_available = 0
    for game in catalog:
        state = str(game.get("availability_state") or "")
        if state in states:
            states[state] += 1
        copies_total += int(game.get("copies_total") or 0)
        copies_available += int(game.get("copies_available") or 0)

    backend_app_ids = {int(g["app_id"]) for g in catalog if g.get("app_id")}
    pool_app_ids = {int(g["app_id"]) for g in pool.get("games") or []}
    runtime_roster_count = int(roster_status.get("accounts") or 0)
    pool_account_count = int(pool.get("account_count") or 0)

    return {
        "sync": {
            "verification_complete": bool(pool.get("verification_complete")),
            "verification_error_count": len(pool.get("verification_errors") or []),
            "pool_account_count": pool_account_count,
            "pool_game_count": int(pool.get("game_count") or 0),
            "owned_unique_app_count": int(pool.get("owned_unique_app_count") or 0),
            "accessible_app_count": int(pool.get("accessible_app_count") or 0),
            "license_mapping_count": int(pool.get("license_mapping_count") or 0),
            "backend_account_count": int(backend_sync.get("account_count") or 0),
            "backend_game_count": int(backend_sync.get("game_count") or 0),
            "backend_total_license_mappings": int(backend_sync.get("total_license_mappings") or 0),
        },
        "catalog": {
            "count": len(catalog),
            "matches_pool_app_ids": backend_app_ids == pool_app_ids,
            "missing_from_backend_count": len(pool_app_ids - backend_app_ids),
            "extra_in_backend_count": len(backend_app_ids - pool_app_ids),
            "ready_games": states["ready"],
            "owned_busy_games": states["owned-busy"],
            "unavailable_games": states["unavailable"],
            "copies_total": copies_total,
            "copies_available": copies_available,
        },
        "accounts": {
            "runtime_roster_count": runtime_roster_count,
            "pool_account_count": pool_account_count,
            "admin_account_rows": len(admin_accounts),
            "roster_matches_pool": runtime_roster_count == pool_account_count,
            "backend_rows_match_roster": len(admin_accounts) == runtime_roster_count,
        },
    }


def main() -> int:
    health, started_pid = ensure_backend()
    tests = run_api_tests()
    personal = personal_account_summary()
    provider, provider_compact = provider_summary()
    pool = build_game_pool(refresh_licenses=False)
    result = {
        "ok": False,
        "mode": "cached-no-login-no-download",
        "backend": {
            "health": health,
            "started_pid": started_pid,
        },
        "tests": tests,
        "personal_accounts": personal,
        "provider_accounts": provider_compact,
        "pool_pre_sync": compact_pool(pool),
    }
    if not pool.get("ok"):
        result["error"] = "provider pool did not pass local validation"
        print(_json(result))
        return 2

    result["backend_verification"] = backend_summary(pool)
    checks = result["backend_verification"]
    result["ok"] = bool(
        tests.get("ok")
        and provider_compact.get("ok")
        and checks["catalog"]["matches_pool_app_ids"]
        and checks["accounts"]["roster_matches_pool"]
        and checks["accounts"]["backend_rows_match_roster"]
    )
    print(_json(result))
    return 0 if result["ok"] else 3


if __name__ == "__main__":
    raise SystemExit(main())
