"""Low-level Steam CDN transfer adapter for GameAccess.

This module owns exactly one DepotDownloader invocation at a time. Higher-level
provider selection, job lifecycle and Steam-library placement belong to
``provider_download_manager.py``.

Credentials never appear in argv. Each live invocation reserves a unique
32-bit Steam LoginID, which allows concurrent DepotDownloader sessions even
when two game downloads use the same provider account. DepotDownloader tool
bootstrap is protected by a cross-process lock so first-run parallel downloads
cannot extract into the same directory simultaneously.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import queue
import re
import subprocess
import tempfile
import threading
import time
import urllib.request
import zipfile
import zlib
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from pool_sync import _ownership_state_by_provider
from provider_inventory import build_provider_catalog
from provider_roster import credential_by_provider_id

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_ROOT = Path(__file__).resolve().parent / ".gameaccess"
TOOL_VERSION = "3.4.0"
TOOL_URL = (
    "https://github.com/SteamRE/DepotDownloader/releases/download/"
    "DepotDownloader_3.4.0/DepotDownloader-windows-x64.zip"
)
TOOL_ROOT = RUNTIME_ROOT / "tools" / f"depotdownloader-{TOOL_VERSION}"
LOCK_ROOT = RUNTIME_ROOT / "locks"
TOOL_LOCK_PATH = LOCK_ROOT / f"depotdownloader-{TOOL_VERSION}.lock"
LOGIN_ID_ROOT = LOCK_ROOT / "download-loginids"
DOWNLOAD_ROOT = RUNTIME_ROOT / "downloads"
DOWNLOAD_LOGIN_ID_BASE = 0x47420000  # "GB" namespace; low 16 bits are allocated per live worker.
LOCK_STALE_SECONDS = 6 * 60 * 60


def _sanitize(text: str, *secrets: str) -> str:
    safe = text
    for secret in secrets:
        if secret:
            safe = safe.replace(secret, "[REDACTED]")
    return safe


def _remove_if_stale(path: Path, stale_seconds: float = LOCK_STALE_SECONDS) -> bool:
    try:
        age = time.time() - path.stat().st_mtime
    except OSError:
        return False
    if age <= stale_seconds:
        return False
    try:
        path.unlink()
        return True
    except OSError:
        return False


@contextmanager
def _exclusive_file_lock(path: Path, timeout_seconds: float = 180.0) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(json.dumps({"pid": os.getpid(), "created_at": time.time()}))
            break
        except FileExistsError:
            if _remove_if_stale(path):
                continue
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Timed out waiting for lock {path}")
            time.sleep(0.1)
    try:
        yield
    finally:
        try:
            path.unlink()
        except FileNotFoundError:
            pass


@contextmanager
def reserve_download_login_id(provider_id: str, app_id: int) -> Iterator[int]:
    """Reserve a collision-safe LoginID for one live DepotDownloader process."""
    LOGIN_ID_ROOT.mkdir(parents=True, exist_ok=True)
    seed = f"{provider_id}:{app_id}:{os.getpid()}:{time.time_ns()}".encode("utf-8")
    start = zlib.crc32(seed) & 0xFFFF
    if start == 0:
        start = 1
    reservation: Path | None = None
    login_id = 0
    for offset in range(0xFFFF):
        slot = ((start + offset - 1) % 0xFFFF) + 1
        candidate = DOWNLOAD_LOGIN_ID_BASE + slot
        path = LOGIN_ID_ROOT / f"{candidate}.lock"
        if path.exists() and _remove_if_stale(path):
            pass
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(
                json.dumps(
                    {
                        "pid": os.getpid(),
                        "provider_id": provider_id,
                        "app_id": app_id,
                        "created_at": time.time(),
                    }
                )
            )
        reservation = path
        login_id = candidate
        break
    if reservation is None:
        raise RuntimeError("GameAccess could not reserve a unique Steam LoginID")
    try:
        yield login_id
    finally:
        try:
            reservation.unlink()
        except FileNotFoundError:
            pass


def _find_executable(root: Path) -> Path | None:
    direct = root / "DepotDownloader.exe"
    if direct.is_file():
        return direct
    for candidate in root.rglob("DepotDownloader.exe"):
        if candidate.is_file():
            return candidate
    return None


def ensure_depotdownloader() -> dict[str, Any]:
    existing = _find_executable(TOOL_ROOT)
    if existing:
        return {
            "path": str(existing),
            "version": TOOL_VERSION,
            "source": TOOL_URL,
            "installed": True,
            "downloaded_now": False,
        }

    with _exclusive_file_lock(TOOL_LOCK_PATH):
        existing = _find_executable(TOOL_ROOT)
        if existing:
            return {
                "path": str(existing),
                "version": TOOL_VERSION,
                "source": TOOL_URL,
                "installed": True,
                "downloaded_now": False,
            }

        TOOL_ROOT.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(
            TOOL_URL,
            headers={"User-Agent": "GameAccess-DepotDownloader-Probe/1.0"},
        )
        with tempfile.NamedTemporaryFile(
            prefix="depotdownloader-", suffix=".zip", delete=False
        ) as temp:
            temp_path = Path(temp.name)
            digest = hashlib.sha256()
            with urllib.request.urlopen(request, timeout=60) as response:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    temp.write(chunk)
                    digest.update(chunk)
        try:
            with zipfile.ZipFile(temp_path) as archive:
                bad_member = archive.testzip()
                if bad_member:
                    raise RuntimeError(
                        f"DepotDownloader release archive failed validation at {bad_member}"
                    )
                archive.extractall(TOOL_ROOT)
        finally:
            temp_path.unlink(missing_ok=True)

        executable = _find_executable(TOOL_ROOT)
        if executable is None:
            raise RuntimeError(
                "DepotDownloader.exe was not found after extracting the official release"
            )
        return {
            "path": str(executable),
            "version": TOOL_VERSION,
            "source": TOOL_URL,
            "installed": True,
            "downloaded_now": True,
            "archive_sha256": digest.hexdigest(),
        }


def verified_owned_ids(provider_id: str) -> set[int]:
    ownership_state, _ = _ownership_state_by_provider()
    state = ownership_state.get(provider_id)
    if not state or not state.get("inventory_complete"):
        raise RuntimeError(f"{provider_id} does not have verified SteamKit ownership")
    return {
        int(app_id)
        for app_id in state.get("owned_app_ids") or []
        if str(app_id).isdigit() and int(app_id) > 0
    }


def verified_provider_ids_for_app(app_id: int) -> list[str]:
    ownership_state, _ = _ownership_state_by_provider()
    providers = []
    for provider_id, state in ownership_state.items():
        if not state.get("inventory_complete"):
            continue
        owned_ids = {
            int(value)
            for value in state.get("owned_app_ids") or []
            if str(value).isdigit() and int(value) > 0
        }
        if app_id in owned_ids:
            providers.append(provider_id)
    return sorted(set(providers))


def provider_candidates(provider_id: str) -> list[dict[str, Any]]:
    """Return verified owned Windows candidates, including hidden local metadata cases."""
    owned_ids = verified_owned_ids(provider_id)
    catalog = build_provider_catalog(additional_candidate_ids=owned_ids)
    by_app = {
        int(game["app_id"]): game
        for game in catalog.get("games", [])
        if isinstance(game, dict) and int(game.get("app_id") or 0) > 0
    }
    candidates = [
        {"app_id": app_id, "name": str(by_app[app_id].get("name") or app_id)}
        for app_id in sorted(owned_ids & set(by_app))
    ]
    candidates.sort(key=lambda item: (item["name"].casefold(), item["app_id"]))
    return candidates


def _directory_stats(path: Path) -> tuple[int, int]:
    files = 0
    total = 0
    if not path.exists():
        return files, total
    for item in path.rglob("*"):
        if not item.is_file():
            continue
        files += 1
        try:
            total += item.stat().st_size
        except OSError:
            pass
    return files, total


def _manifest_totals(path: Path) -> dict[str, int]:
    totals: dict[str, int] = {}
    if not path.exists():
        return totals
    for manifest in path.rglob("manifest_*.txt"):
        try:
            body = manifest.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        depot = re.search(r"Content Manifest for Depot\s+(\d+)", body)
        size = re.search(r"Total bytes on disk\s*:\s*(\d+)", body)
        if depot and size:
            totals[depot.group(1)] = int(size.group(1))
    return totals


def _run_streaming(
    argv: list[str],
    *,
    password: str,
    login: str,
    cwd: Path,
    timeout_seconds: int,
    on_output: Callable[[str], None] | None,
) -> tuple[int, str]:
    process = subprocess.Popen(
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=cwd,
    )
    if process.stdin is None or process.stdout is None:
        process.kill()
        raise RuntimeError("DepotDownloader pipes were not created")
    process.stdin.write(password + os.linesep)
    process.stdin.flush()
    process.stdin.close()

    lines: queue.Queue[str | None] = queue.Queue()

    def read_output() -> None:
        try:
            for raw in process.stdout:
                lines.put(raw)
        finally:
            lines.put(None)

    threading.Thread(target=read_output, daemon=True).start()
    collected: list[str] = []
    deadline = time.monotonic() + timeout_seconds
    ended = False
    while not ended:
        if time.monotonic() >= deadline:
            process.kill()
            raise subprocess.TimeoutExpired(argv, timeout_seconds)
        try:
            raw = lines.get(timeout=0.25)
        except queue.Empty:
            continue
        if raw is None:
            ended = True
            continue
        safe = _sanitize(raw.rstrip("\r\n"), password, login)
        collected.append(safe)
        if on_output is not None:
            on_output(safe)
    return process.wait(timeout=10), "\n".join(collected)


def run_probe(
    provider_id: str,
    app_id: int,
    *,
    manifest_only: bool,
    download: bool,
    timeout_seconds: int,
    progress_callback: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    if manifest_only == download:
        raise ValueError("select exactly one of --manifest-only or --download")

    candidates = {item["app_id"]: item for item in provider_candidates(provider_id)}
    if app_id not in candidates:
        raise RuntimeError(
            f"AppID {app_id} is not verified as an owned Windows game for {provider_id}"
        )

    credential = credential_by_provider_id(provider_id)
    if credential is None:
        raise RuntimeError(f"Unknown provider id: {provider_id}")

    tool = ensure_depotdownloader()
    executable = Path(tool["path"])
    mode = "manifest-only" if manifest_only else "download"
    target = DOWNLOAD_ROOT / provider_id / f"{app_id}-{mode}"
    target.mkdir(parents=True, exist_ok=True)

    with reserve_download_login_id(provider_id, app_id) as login_id:
        argv = [
            str(executable),
            "-app",
            str(app_id),
            "-username",
            credential.login,
            "-loginid",
            str(login_id),
            "-dir",
            str(target),
            "-os",
            "windows",
            "-language",
            "english",
            "-max-downloads",
            "4",
        ]
        if manifest_only:
            argv.append("-manifest-only")

        if download and progress_callback is not None:
            returncode, stdout = _run_streaming(
                argv,
                password=credential.password,
                login=credential.login,
                cwd=target,
                timeout_seconds=timeout_seconds,
                on_output=progress_callback,
            )
            stderr = ""
        else:
            completed = subprocess.run(
                argv,
                input=credential.password + os.linesep,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=target,
                timeout=timeout_seconds,
            )
            returncode = completed.returncode
            stdout = _sanitize(
                completed.stdout or "", credential.password, credential.login
            )
            stderr = _sanitize(
                completed.stderr or "", credential.password, credential.login
            )

    files, directory_bytes = _directory_stats(target)
    depot_totals = _manifest_totals(target) if manifest_only else {}
    total_bytes = sum(depot_totals.values()) if depot_totals else directory_bytes
    return {
        "ok": returncode == 0,
        "provider_id": provider_id,
        "app_id": app_id,
        "name": candidates[app_id]["name"],
        "mode": mode,
        "login_id": login_id,
        "exit_code": returncode,
        "target": str(target),
        "file_count": files,
        "total_bytes": total_bytes,
        "depot_totals": depot_totals,
        "tool": tool,
        "stdout_tail": stdout[-6000:],
        "stderr_tail": stderr[-3000:],
    }


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=True))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Test provider-owned Steam CDN downloads without logging the provider into Steam.exe"
    )
    parser.add_argument("--provider-id", required=True)
    parser.add_argument(
        "--list", action="store_true", help="list verified owned Windows games for this provider"
    )
    parser.add_argument("--app-id", type=int)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--manifest-only", action="store_true")
    mode.add_argument("--download", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    args = parser.parse_args()

    if args.list:
        candidates = provider_candidates(args.provider_id)
        _print_json(
            {
                "provider_id": args.provider_id,
                "candidate_count": len(candidates),
                "candidates": candidates,
            }
        )
        return 0
    if not args.app_id or not (args.manifest_only or args.download):
        parser.error("use --list, or provide --app-id with --manifest-only/--download")

    result = run_probe(
        args.provider_id,
        args.app_id,
        manifest_only=args.manifest_only,
        download=args.download,
        timeout_seconds=max(60, args.timeout_seconds),
    )
    _print_json(result)
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
