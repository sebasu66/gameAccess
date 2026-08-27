from __future__ import annotations

import json
import os
import secrets
import string
import subprocess
import sys
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import main as core

router = APIRouter(prefix="/admin-console", tags=["admin-console"])

API_ROOT = Path(__file__).resolve().parent.parent
APPS_ROOT = Path(__file__).resolve().parents[2]
ADMIN_HTML = API_ROOT / "admin" / "index.html"
LAUNCHER_ROOT = APPS_ROOT / "launcher"
TASK_ROOT = API_ROOT / ".admin_tasks"
TASK_ROOT.mkdir(parents=True, exist_ok=True)

_TASKS: dict[str, dict] = {}
_TASK_LOCK = Lock()


class SteamAccountCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    account_name: str = Field(min_length=3, max_length=64)
    country: str = Field(default="Argentina", max_length=100)
    browser: str = Field(default="chrome", pattern="^(chrome|edge)$")
    password: str | None = Field(default=None, min_length=8, max_length=128)
    generate_password: bool = True


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_notes(value: str) -> dict:
    try:
        decoded = json.loads(value or "{}")
        return decoded if isinstance(decoded, dict) else {}
    except Exception:
        return {}


def generate_password(length: int = 20) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%_-"
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(ch.islower() for ch in value)
            and any(ch.isupper() for ch in value)
            and any(ch.isdigit() for ch in value)
            and any(not ch.isalnum() for ch in value)
        ):
            return value


def launcher_python() -> Path:
    candidates = [
        LAUNCHER_ROOT / ".venv" / "Scripts" / "python.exe",
        LAUNCHER_ROOT / ".venv" / "bin" / "python",
        Path(sys.executable),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return Path(sys.executable)


def task_log_tail(task: dict, max_chars: int = 7000) -> str:
    path = Path(task["log_path"])
    if not path.is_file():
        return ""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        return f"No se pudo leer el log: {exc}"
    return text[-max_chars:]


def task_public(task_id: str, task: dict) -> dict:
    process: subprocess.Popen | None = task.get("process")
    code = process.poll() if process else task.get("exit_code")
    if process and code is not None:
        task["exit_code"] = code
        task["finished_at"] = task.get("finished_at") or now_iso()
    if code is None:
        status = "running"
    elif code == 0:
        status = "done"
    else:
        status = "error"
    log = task_log_tail(task)
    state = None
    for line in reversed(log.splitlines()):
        if line.startswith("STATE="):
            state = line.partition("=")[2].strip()
            break
    return {
        "id": task_id,
        "kind": task["kind"],
        "label": task["label"],
        "status": status,
        "state": state,
        "started_at": task["started_at"],
        "finished_at": task.get("finished_at"),
        "exit_code": code,
        "log": log,
    }


def start_task(kind: str, label: str, argv: list[str], *, env: dict[str, str] | None = None) -> dict:
    task_id = uuid.uuid4().hex[:12]
    log_path = TASK_ROOT / f"{task_id}.log"
    log_handle = open(log_path, "w", encoding="utf-8", buffering=1)
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    creationflags = 0
    if os.name == "nt":
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    try:
        process = subprocess.Popen(
            argv,
            cwd=str(LAUNCHER_ROOT),
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=merged_env,
            text=True,
            creationflags=creationflags,
        )
    except Exception:
        log_handle.close()
        raise
    with _TASK_LOCK:
        _TASKS[task_id] = {
            "kind": kind,
            "label": label,
            "process": process,
            "log_path": str(log_path),
            "log_handle": log_handle,
            "started_at": now_iso(),
        }
    return task_public(task_id, _TASKS[task_id])


def dashboard(session: Session) -> dict:
    core.expire_old_leases(session)
    accounts = session.exec(select(core.ProviderAccount)).all()
    games = session.exec(select(core.Game)).all()
    users = session.exec(select(core.User)).all()
    mappings = session.exec(select(core.AccountGame)).all()
    leases = session.exec(select(core.Lease)).all()

    active_leases = [lease for lease in leases if lease.status == core.LeaseStatus.active]
    active_by_account = {lease.account_id: lease for lease in active_leases}
    mappings_by_account: dict[int, list[core.AccountGame]] = {}
    mappings_by_game: dict[int, list[core.AccountGame]] = {}
    for mapping in mappings:
        mappings_by_account.setdefault(mapping.account_id, []).append(mapping)
        mappings_by_game.setdefault(mapping.game_id, []).append(mapping)

    account_rows = []
    for account in accounts:
        rows = mappings_by_account.get(account.id or -1, [])
        owned_games = [session.get(core.Game, row.game_id) for row in rows]
        notes = parse_notes(account.notes)
        lease = active_by_account.get(account.id or -1)
        account_rows.append(
            {
                "id": account.id,
                "label": account.label,
                "provider": account.provider,
                "status": account.status,
                "game_count": len(rows),
                "active_lease_id": lease.id if lease else None,
                "identity": {
                    "account_name": notes.get("account_name"),
                    "steam_id64": notes.get("steam_id64"),
                    "user_id32": notes.get("user_id32"),
                },
                "games_preview": [game.name for game in owned_games if game][:8],
            }
        )

    license_rows = []
    for game in games:
        owners = []
        available = 0
        for mapping in mappings_by_game.get(game.id or -1, []):
            account = session.get(core.ProviderAccount, mapping.account_id)
            if not account:
                continue
            owners.append({"id": account.id, "label": account.label, "status": account.status})
            if account.status == core.AccountStatus.free:
                available += 1
        if owners or game.active:
            license_rows.append(
                {
                    "game_id": game.id,
                    "app_id": game.app_id,
                    "name": game.name,
                    "active": game.active,
                    "cost_per_hour": game.credit_cost_per_hour,
                    "copies_total": len(owners),
                    "copies_available": available,
                    "owners": owners,
                }
            )
    license_rows.sort(key=lambda item: (-item["copies_total"], item["name"].casefold()))

    seat_rows = [
        {
            "account_id": account["id"],
            "label": account["label"],
            "state": "available" if account["status"] == core.AccountStatus.free else account["status"],
            "active_lease_id": account["active_lease_id"],
            "game_count": account["game_count"],
        }
        for account in account_rows
    ]

    recent_leases = []
    for lease in sorted(leases, key=lambda item: item.starts_at, reverse=True)[:30]:
        game = session.get(core.Game, lease.game_id)
        account = session.get(core.ProviderAccount, lease.account_id)
        user = session.get(core.User, lease.user_id)
        recent_leases.append(
            {
                "id": lease.id,
                "status": lease.status,
                "game": game.name if game else f"game:{lease.game_id}",
                "account": account.label if account else f"account:{lease.account_id}",
                "user": user.username if user else f"user:{lease.user_id}",
                "starts_at": lease.starts_at,
                "expires_at": lease.expires_at,
                "credits_spent": lease.credits_spent,
            }
        )

    diagnostics = []
    if not accounts:
        diagnostics.append({"level": "error", "code": "pool_empty", "message": "No hay cuentas en el pool."})
    if not mappings:
        diagnostics.append({"level": "error", "code": "licenses_empty", "message": "No hay licencias asociadas a cuentas."})

    active_game_count = sum(1 for game in games if game.active)
    active_without_license = [
        game.name for game in games if game.active and not mappings_by_game.get(game.id or -1)
    ]
    if active_without_license:
        diagnostics.append(
            {
                "level": "warning",
                "code": "active_without_license",
                "message": f"{len(active_without_license)} juegos activos no tienen ninguna licencia.",
                "examples": active_without_license[:8],
            }
        )

    for account in accounts:
        lease = active_by_account.get(account.id or -1)
        if account.status == core.AccountStatus.leased and not lease:
            diagnostics.append(
                {
                    "level": "error",
                    "code": "leased_without_lease",
                    "message": f"{account.label} figura leased pero no tiene lease activo.",
                }
            )
        if account.status == core.AccountStatus.free and lease:
            diagnostics.append(
                {
                    "level": "error",
                    "code": "free_with_active_lease",
                    "message": f"{account.label} figura free pero tiene el lease activo #{lease.id}.",
                }
            )

    duplicate_pairs = Counter((row.account_id, row.game_id) for row in mappings)
    duplicate_count = sum(count - 1 for count in duplicate_pairs.values() if count > 1)
    if duplicate_count:
        diagnostics.append(
            {
                "level": "warning",
                "code": "duplicate_license_mapping",
                "message": f"Hay {duplicate_count} asociaciones cuenta/juego duplicadas.",
            }
        )

    task_rows = []
    with _TASK_LOCK:
        for task_id, task in list(_TASKS.items())[-20:]:
            task_rows.append(task_public(task_id, task))
    for task in task_rows:
        if task["status"] == "error":
            diagnostics.append(
                {
                    "level": "error",
                    "code": "tool_error",
                    "message": f"La herramienta '{task['label']}' terminó con error.",
                    "task_id": task["id"],
                }
            )

    return {
        "generated_at": now_iso(),
        "stats": {
            "accounts_total": len(accounts),
            "accounts_available": sum(1 for account in accounts if account.status == core.AccountStatus.free),
            "accounts_leased": sum(1 for account in accounts if account.status == core.AccountStatus.leased),
            "accounts_disabled": sum(1 for account in accounts if account.status == core.AccountStatus.disabled),
            "active_games": active_game_count,
            "license_mappings": len(mappings),
            "distinct_licensed_games": len(mappings_by_game),
            "active_leases": len(active_leases),
            "users": len(users),
            "credits_total": sum(user.credits for user in users),
        },
        "accounts": account_rows,
        "licenses": license_rows,
        "seats": seat_rows,
        "leases": recent_leases,
        "diagnostics": diagnostics,
        "tasks": task_rows,
        "seat_model": "Cada ProviderAccount cuenta hoy como un asiento operativo. Steam Families se modelará como capa separada sin cambiar el inventario de licencias.",
    }


@router.get("/")
def admin_console() -> FileResponse:
    if not ADMIN_HTML.is_file():
        raise HTTPException(404, "admin console HTML not found")
    return FileResponse(ADMIN_HTML)


@router.get("/overview")
def overview(session: Session = Depends(core.get_session)) -> dict:
    return dashboard(session)


@router.get("/tasks")
def tasks() -> list[dict]:
    with _TASK_LOCK:
        return [task_public(task_id, task) for task_id, task in reversed(list(_TASKS.items()))]


@router.post("/tasks/{task_id}/stop")
def stop_task(task_id: str) -> dict:
    with _TASK_LOCK:
        task = _TASKS.get(task_id)
        if not task:
            raise HTTPException(404, "task not found")
        process: subprocess.Popen = task["process"]
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        task["finished_at"] = now_iso()
        return task_public(task_id, task)


@router.post("/tools/steam-account/start")
def start_steam_account(req: SteamAccountCreateRequest) -> dict:
    script = LAUNCHER_ROOT / "steam_create_account.py"
    if not script.is_file():
        raise HTTPException(500, "steam_create_account.py not found")
    password = req.password if (req.password and not req.generate_password) else generate_password()
    env = {"GAMEACCESS_STEAM_PASSWORD": password}
    argv = [
        str(launcher_python()),
        str(script),
        "--managed",
        "--email",
        req.email.strip(),
        "--account-name",
        req.account_name.strip(),
        "--country",
        req.country.strip() or "Argentina",
        "--browser",
        req.browser,
    ]
    try:
        task = start_task("steam_account", f"Crear Steam {req.account_name}", argv, env=env)
    except Exception as exc:
        raise HTTPException(500, f"No se pudo iniciar Selenium: {exc}") from exc
    return {
        "ok": True,
        "task": task,
        "credentials": {
            "email": req.email.strip(),
            "account_name": req.account_name.strip(),
            "password": password,
        },
        "note": "La contraseña se devuelve una sola vez y no se guarda en el dashboard. CAPTCHA y verificación de email siguen siendo pasos humanos visibles.",
    }


@router.post("/tools/pool-sync/start")
def start_pool_sync() -> dict:
    script = LAUNCHER_ROOT / "pool_sync.py"
    if not script.is_file():
        raise HTTPException(500, "pool_sync.py not found")
    argv = [str(launcher_python()), str(script), "--api", "http://127.0.0.1:8000", "--compact"]
    try:
        task = start_task("pool_sync", "Sincronizar pool Steam local", argv)
    except Exception as exc:
        raise HTTPException(500, f"No se pudo iniciar pool_sync: {exc}") from exc
    return {"ok": True, "task": task}
