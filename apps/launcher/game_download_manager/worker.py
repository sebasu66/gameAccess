#!/usr/bin/env python3
"""
digital_downloader.py

Tauri/Rust IPC-compatible Game Downloader & Installer.
Communicates via newline-delimited JSON (ndjson) over stdout with autoflush.
Supports:
  - Multi-threaded segmented downloading (HTTP Range)
  - TorBox torrent/magnet resolution and caching
  - Extraction via bundled portable 7-Zip with optional local execution profiles
  - Custom post-download installation commands
  - Clean cancellation (SIGINT / SIGTERM) with process and temp file cleanup
"""

import sys
import os
import re
import json
import time
import math
import shutil
import signal
import argparse
import threading
import subprocess
from urllib.parse import urlparse, unquote, parse_qs
from html import unescape
from pathlib import Path
from typing import Optional, Dict, Any, List
import requests

import logging
from flow_diagnostics import FlowDiagnostics, FlowLogger
from logging.handlers import RotatingFileHandler

LAUNCHER_DIR = Path(__file__).resolve().parent.parent

log_dir = LAUNCHER_DIR / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
import app_log
logger = app_log.configure("digital_downloader", "downloads.log", log_dir)

# Ensure stdout uses UTF-8 and auto-flushes
if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Global cancellation and child process tracking
g_cancelled = threading.Event()
g_paused = threading.Event()
g_status_lock = threading.RLock()
g_last_payload = {}

def wait_if_paused():
    torrent_paused = False
    while g_paused.is_set() and not g_cancelled.is_set():
        if g_torrent_session is not None and not torrent_paused:
            g_torrent_session.pause()
            torrent_paused = True
        time.sleep(0.1)
    if torrent_paused and g_torrent_session is not None and not g_cancelled.is_set():
        g_torrent_session.resume()

def watch_controls():
    control_file = LAUNCHER_DIR / ".cache" / "digital_downloads" / f"{g_app_id}.control.json"
    last_request = None
    last_heartbeat = time.monotonic()
    while not g_cancelled.wait(0.1):
        if time.monotonic() - last_heartbeat >= 1:
            with g_status_lock:
                if g_last_payload.get("phase") in ("completed", "error", "cancelled"):
                    return
                if g_last_payload:
                    emit_json(dict(g_last_payload))
            last_heartbeat = time.monotonic()
        try:
            control = json.loads(control_file.read_text(encoding="utf-8"))
            if control.get("requestId") == last_request:
                continue
            last_request = control.get("requestId")
            action = control.get("action")
            if action == "cancel":
                g_paused.clear()
                g_cancelled.set()
                if g_active_subprocess and g_active_subprocess.poll() is None:
                    g_active_subprocess.terminate()
                return
            if action == "pause" and g_last_payload.get("phase") in ("downloading", "preparing", None):
                g_paused.set()
                emit_json(dict(g_last_payload))
            elif action == "resume" and g_paused.is_set():
                g_paused.clear()
                emit_json(dict(g_last_payload))
        except (OSError, ValueError):
            pass

g_active_subprocess: Optional[subprocess.Popen] = None
g_torrent_session = None
g_temp_files: List[str] = []
g_cancel_hooks: List[Any] = []
g_app_id: str = ""
g_diagnostics = None

def emit_json(payload: dict):
    global g_last_payload
    with g_status_lock:
        if g_diagnostics is not None:
            phase = payload.get("phase")
            if phase != g_last_payload.get("phase"):
                g_diagnostics.debug("phase=%s bytes=%s total=%s", phase,
                                    payload.get("bytesDownloaded"), payload.get("totalBytes"))
            if phase == "error":
                g_diagnostics.fail(payload.get("error", "Download failed"))
            elif phase in ("completed", "cancelled", "external"):
                g_diagnostics.discard()
        g_last_payload = dict(payload)
        payload = dict(payload, workerPid=os.getpid())
        if g_paused.is_set() and payload.get("phase") in ("preparing", "downloading"):
            payload.update(phase="paused", statusText="Descarga pausada", speedBps=0, etaSeconds=0)
        _write_status(payload)

def _write_status(payload: dict):
    """Emits a single-line JSON event to stdout with immediate flush and updates cached status file."""
    try:
        line = json.dumps(payload, ensure_ascii=False)
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except Exception as e:
        sys.stderr.write(f"Failed to emit JSON: {e}\n")
        sys.stderr.flush()

    try:
        app_id = payload.get("appId") or g_app_id
        if app_id:
            status_dir = LAUNCHER_DIR / ".cache" / "digital_downloads"
            status_dir.mkdir(parents=True, exist_ok=True)
            status_file = status_dir / f"{app_id}.json"
            temp_file = status_dir / f"{app_id}.json.tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            # Windows readers can briefly deny replacement of the status file.
            # Keep the terminal event durable instead of silently losing it.
            for attempt in range(20):
                try:
                    os.replace(temp_file, status_file)
                    break
                except PermissionError:
                    if attempt == 19:
                        raise
                    time.sleep(0.05)
    except Exception:
        logger.warning("AppID %s: could not persist download status", payload.get("appId") or g_app_id, exc_info=True)

def emit_progress(
    app_id: str,
    phase: str,
    progress_percent: float,
    bytes_downloaded: int = 0,
    total_bytes: int = 0,
    speed_bps: int = 0,
    eta_seconds: int = 0,
    status_text: str = ""
):
    reported_progress = float(progress_percent)
    raw_percent = max(0.0, min(100.0, reported_progress))
    # Download and installation (extraction) are reported on their own scales so the player can
    # show two bars; the combined progressPercent below stays for older consumers.
    download_percent = raw_percent if phase == "downloading" else (100.0 if phase in ("decompressing", "installing", "completed") else 0.0)
    install_percent = raw_percent if phase in ("decompressing", "installing") else (100.0 if phase == "completed" else 0.0)
    if phase == "preparing":
        reported_progress = 0.0
    elif phase == "downloading":
        reported_progress = reported_progress * 0.5
    elif phase == "decompressing":
        reported_progress = 50.0 + (reported_progress * 0.5)

    # Strip manually added percentages from status_text so UI can handle the scaled progress
    clean_text = re.sub(r' \(\d+(\.\d+)?%\)', '', status_text)
    clean_text = re.sub(r' — \d+(\.\d+)?%', '', clean_text)
    clean_text = re.sub(r' - \d+(\.\d+)?%', '', clean_text)
    clean_text = clean_text.strip()

    emit_json({
        "type": "progress",
        "appId": str(app_id),
        "phase": phase,
        "progressPercent": round(reported_progress, 1),
        "downloadPercent": round(download_percent, 1),
        "installPercent": round(install_percent, 1),
        "bytesDownloaded": int(bytes_downloaded),
        "totalBytes": int(total_bytes),
        "speedBps": int(speed_bps),
        "etaSeconds": int(eta_seconds),
        "statusText": clean_text
    })

def emit_error(app_id: str, error_message: str):
    emit_json({
        "type": "error",
        "appId": str(app_id),
        "phase": "error",
        "error": error_message,
        "statusText": f"Error: {error_message}"
    })

def cleanup_on_cancel(signum=None, frame=None, error_message=None):
    """Graceful cleanup handler for SIGINT/SIGTERM."""
    global g_cancelled, g_active_subprocess, g_temp_files, g_app_id, g_torrent_session
    g_cancelled.set()
    
    if g_torrent_session is not None:
        try:
            g_torrent_session.pause()
        except Exception:
            pass

    # Terminate active external process if any
    if g_active_subprocess and g_active_subprocess.poll() is None:
        try:
            g_active_subprocess.terminate()
            time.sleep(0.5)
            if g_active_subprocess.poll() is None:
                g_active_subprocess.kill()
        except Exception:
            pass

    # Delete incomplete files
    for path in g_temp_files:
        if os.path.isfile(path):
            try:
                os.remove(path)
            except Exception:
                pass
        elif os.path.isdir(path):
            try:
                shutil.rmtree(path, ignore_errors=True)
            except Exception:
                pass

    if error_message:
        emit_error(g_app_id, error_message)
    else:
        # Aborting a download removes the whole game folder (it used to leave an empty one behind).
        for hook in list(g_cancel_hooks):
            try:
                hook()
            except Exception:
                logger.warning("AppID %s: cancel cleanup failed", g_app_id, exc_info=True)
        emit_progress(g_app_id, "cancelled", 0, status_text="Descarga cancelada")
    sys.exit(1 if error_message else 130)

# Register signal handlers
signal.signal(signal.SIGINT, cleanup_on_cancel)
signal.signal(signal.SIGTERM, cleanup_on_cancel)
if hasattr(signal, "SIGBREAK"):
    signal.signal(signal.SIGBREAK, cleanup_on_cancel)


from game_download_manager.extractor import ARCHIVE_EXTENSIONS, find_portable_7z, is_archive, delete_archive_and_parts, archive_member_names, ArchiveExtractor
from game_download_manager.source_validation import normalize_download_source, is_torrent_source, validate_http_file_response, validate_downloaded_file
from game_download_manager.http_transport import HttpDownloadTransport
from game_download_manager.torrent_transport import TorrentDownloadTransport
from game_download_manager.debrid import TorboxClient
from game_download_manager.context import DownloadContext


def _set_process(value):
    global g_active_subprocess
    g_active_subprocess = value


def _set_torrent(value):
    global g_torrent_session
    g_torrent_session = value


def _context():
    return DownloadContext(
        launcher_dir=LAUNCHER_DIR, app_id=g_app_id, cancelled=g_cancelled,
        temp_files=g_temp_files, logger=FlowLogger(logger, g_diagnostics) if g_diagnostics else logger, emit_progress=emit_progress,
        emit_error=emit_error, wait_if_paused=wait_if_paused,
        find_portable_7z=find_portable_7z, archive_member_names=archive_member_names,
        archive_enclosing_folder=archive_enclosing_folder,
        get_process=lambda: g_active_subprocess, set_process=_set_process,
        get_torrent=lambda: g_torrent_session, set_torrent=_set_torrent,
        cancel_hooks=g_cancel_hooks,
    )


def download_segmented(*args, **kwargs):
    return HttpDownloadTransport(_context()).download_segmented(*args, **kwargs)


def download_direct_torrent(*args, **kwargs):
    return TorrentDownloadTransport(_context()).download_direct_torrent(*args, **kwargs)


def request_archive_passwords():
    return ArchiveExtractor(_context()).request_archive_passwords()


def archive_enclosing_folder(*args, **kwargs):
    return ArchiveExtractor(_context()).archive_enclosing_folder(*args, **kwargs)


def extract_archives_in_path(*args, **kwargs):
    return ArchiveExtractor(_context()).extract_archives_in_path(*args, **kwargs)


def main():
    parser = argparse.ArgumentParser(
        description="digital_downloader.py: Download & Install Pipeline for Tauri/Rust IPC"
    )
    parser.add_argument("--app-id", "--appId", dest="appId", required=True, help="Application/Game ID (e.g. 1091500)")
    parser.add_argument("-name", "--name", required=True, help="Game/Application Display Name")
    parser.add_argument("--source-delivery", choices=("download", "browser"), default="download")
    parser.add_argument("--source", "--download-source", dest="download_source", default="", help="Explicit HTTP/HTTPS link or magnet supplied manually or by a plugin")
    parser.add_argument("--auto-installed", action="store_true", help="Source policy: omit patch backup/reapply rules")
    parser.add_argument("--install-process", default=None, help="Terminal command sequence to execute post-download")
    parser.add_argument("--destination-dir", default=None, help="Destination folder (default: ./games)")
    parser.add_argument("--torbox-key", default=os.getenv("TORBOX_API_KEY", ""), help="TorBox API Key")
    parser.add_argument("--password", "-P", default=None, help="Custom archive password")
    parser.add_argument("--connections", "-n", type=int, default=4, help="Parallel download connections")
    parser.add_argument("--delete-archive", action="store_true", default=True, help="Delete archive files after extraction")
    parser.add_argument("--keep-archive", action="store_true", help="Keep archive after decompressing")
    parser.add_argument("--extract-only", default=None, help="Retry extraction of an already downloaded file or directory")

    args = parser.parse_args()

    global g_app_id, g_diagnostics
    g_app_id = str(args.appId)
    g_diagnostics = FlowDiagnostics(logger, "download-install", g_app_id)
    g_diagnostics.debug("Worker started; extract_only=%s connections=%s", bool(args.extract_only), args.connections)
    from game_download_manager.pipeline import DownloadPipeline
    try:
        DownloadPipeline(_context(), watch_controls=watch_controls,
            cleanup_on_cancel=cleanup_on_cancel, download_http=download_segmented,
            download_torrent=download_direct_torrent,
            extract_archives=extract_archives_in_path).run(args)
    except SystemExit as error:
        if error.code not in (None, 0, 130):
            g_diagnostics.fail("Worker exited with code %s" % error.code)
        raise
    except Exception as error:
        g_diagnostics.fail(error)
        raise
    finally:
        g_diagnostics.discard()

if __name__ == "__main__":
    main()
