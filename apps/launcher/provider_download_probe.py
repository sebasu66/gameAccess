"""Prototype provider download path for GameAccess.

This tool exercises the path we want for background downloads:

provider roster -> SteamKit verified ownership -> DepotDownloader -> Steam CDN.

It never places the provider password in argv. DepotDownloader is invoked with
``-username`` and receives the password through stdin. Output is sanitized
before it is returned or logged.

The default mode only lists provider-owned Windows games. ``--manifest-only``
verifies depot/manifest access without downloading full game content.
``--download`` performs the real content download into an isolated test folder.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from provider_inventory import build_provider_catalog
from provider_license_scan import (
    _login_id_for_provider,
    load_provider_license_inventory,
)
from provider_roster import credential_by_provider_id

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_ROOT = Path(__file__).resolve().parent / ".gameaccess"
TOOL_VERSION = "3.4.0"
TOOL_URL = (
    "https://github.com/SteamRE/DepotDownloader/releases/download/"
    "DepotDownloader_3.4.0/DepotDownloader-windows-x64.zip"
)
TOOL_ROOT = RUNTIME_ROOT / "tools" / f"depotdownloader-{TOOL_VERSION}"
DOWNLOAD_ROOT = RUNTIME_ROOT / "downloads"


def _sanitize(text: str, *secrets: str) -> str:
    safe = text
    for secret in secrets:
        if secret:
            safe = safe.replace(secret, "[REDACTED]")
    return safe


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

    TOOL_ROOT.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        TOOL_URL,
        headers={"User-Agent": "GameAccess-DepotDownloader-Probe/1.0"},
    )
    with tempfile.NamedTemporaryFile(prefix="depotdownloader-", suffix=".zip", delete=False) as temp:
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
                raise RuntimeError(f"DepotDownloader release archive failed validation at {bad_member}")
            archive.extractall(TOOL_ROOT)
    finally:
        temp_path.unlink(missing_ok=True)

    executable = _find_executable(TOOL_ROOT)
    if executable is None:
        raise RuntimeError("DepotDownloader.exe was not found after extracting the official release")
    return {
        "path": str(executable),
        "version": TOOL_VERSION,
        "source": TOOL_URL,
        "installed": True,
        "downloaded_now": True,
        "archive_sha256": digest.hexdigest(),
    }


def provider_candidates(provider_id: str) -> list[dict[str, Any]]:
    inventory = load_provider_license_inventory()
    if not inventory:
        raise RuntimeError("No local SteamKit provider license snapshot exists yet")
    account = next(
        (
            item
            for item in inventory.get("accounts", [])
            if isinstance(item, dict) and item.get("provider_id") == provider_id
        ),
        None,
    )
    if not account or account.get("scan_status") != "ok":
        raise RuntimeError(f"{provider_id} does not have a successful SteamKit ownership snapshot")

    owned_ids = {int(app_id) for app_id in account.get("owned_app_ids") or [] if int(app_id) > 0}
    catalog = build_provider_catalog()
    by_app = {
        int(game["app_id"]): game
        for game in catalog.get("games", [])
        if isinstance(game, dict) and int(game.get("app_id") or 0) > 0
    }
    candidates = [
        {
            "app_id": app_id,
            "name": str(by_app[app_id].get("name") or app_id),
        }
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


def run_probe(
    provider_id: str,
    app_id: int,
    *,
    manifest_only: bool,
    download: bool,
    timeout_seconds: int,
) -> dict[str, Any]:
    if manifest_only == download:
        raise ValueError("select exactly one of --manifest-only or --download")

    candidates = {item["app_id"]: item for item in provider_candidates(provider_id)}
    if app_id not in candidates:
        raise RuntimeError(f"AppID {app_id} is not verified as an owned Windows game for {provider_id}")

    credential = credential_by_provider_id(provider_id)
    if credential is None:
        raise RuntimeError(f"Unknown provider id: {provider_id}")

    tool = ensure_depotdownloader()
    executable = Path(tool["path"])
    mode = "manifest-only" if manifest_only else "download"
    target = DOWNLOAD_ROOT / provider_id / f"{app_id}-{mode}"
    target.mkdir(parents=True, exist_ok=True)
    login_id = _login_id_for_provider(provider_id)

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

    completed = subprocess.run(
        argv,
        input=credential.password + os.linesep,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=target,
        timeout=timeout_seconds,
    )
    stdout = _sanitize(completed.stdout or "", credential.password, credential.login)
    stderr = _sanitize(completed.stderr or "", credential.password, credential.login)
    files, total_bytes = _directory_stats(target)
    return {
        "ok": completed.returncode == 0,
        "provider_id": provider_id,
        "app_id": app_id,
        "name": candidates[app_id]["name"],
        "mode": mode,
        "login_id": login_id,
        "exit_code": completed.returncode,
        "target": str(target),
        "file_count": files,
        "total_bytes": total_bytes,
        "tool": tool,
        "stdout_tail": stdout[-6000:],
        "stderr_tail": stderr[-3000:],
    }


def _print_json(value: Any) -> None:
    # Windows console code pages are not guaranteed to be UTF-8; escaped JSON
    # keeps game titles lossless and machine-readable without console failures.
    print(json.dumps(value, ensure_ascii=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="Test provider-owned Steam CDN downloads without logging the provider into Steam.exe")
    parser.add_argument("--provider-id", required=True)
    parser.add_argument("--list", action="store_true", help="list verified owned Windows games for this provider")
    parser.add_argument("--app-id", type=int)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--manifest-only", action="store_true")
    mode.add_argument("--download", action="store_true")
    parser.add_argument("--timeout-seconds", type=int, default=900)
    args = parser.parse_args()

    if args.list:
        candidates = provider_candidates(args.provider_id)
        _print_json({"provider_id": args.provider_id, "candidate_count": len(candidates), "candidates": candidates})
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
