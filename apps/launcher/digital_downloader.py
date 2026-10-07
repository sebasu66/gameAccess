#!/usr/bin/env python3
"""
digital_downloader.py

Tauri/Rust IPC-compatible Game Downloader & Installer.
Communicates via newline-delimited JSON (ndjson) over stdout with autoflush.
Supports:
  - Multi-threaded segmented downloading (HTTP Range)
  - TorBox torrent/magnet resolution and caching
  - Extraction via bundled portable 7-Zip with host/password adaptation
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
from urllib.parse import urlparse, unquote
from pathlib import Path
from typing import Optional, Dict, Any, List
import requests

import logging
from logging.handlers import RotatingFileHandler

LAUNCHER_DIR = Path(__file__).resolve().parent

log_dir = LAUNCHER_DIR / "logs"
log_dir.mkdir(parents=True, exist_ok=True)
logger = logging.getLogger("digital_downloader")
logger.setLevel(logging.INFO)
handler = RotatingFileHandler(log_dir / "downloads.log", maxBytes=1048576, backupCount=0, encoding="utf-8")
handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(message)s'))
logger.addHandler(handler)

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
            if action == "pause" and g_last_payload.get("phase") in ("downloading", "preparing"):
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
g_app_id: str = ""

def emit_json(payload: dict):
    global g_last_payload
    with g_status_lock:
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
            os.replace(temp_file, status_file)
    except Exception:
        pass

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
        emit_progress(g_app_id, "cancelled", 0, status_text="Descarga cancelada")
    sys.exit(1 if error_message else 130)

# Register signal handlers
signal.signal(signal.SIGINT, cleanup_on_cancel)
signal.signal(signal.SIGTERM, cleanup_on_cancel)
if hasattr(signal, "SIGBREAK"):
    signal.signal(signal.SIGBREAK, cleanup_on_cancel)


# --- 7-Zip & Extraction Helpers ---
HOST_PROFILES: Dict[str, Dict[str, Any]] = {
    "X": {
        "password": "zzzz",
        "description": "Host X profile",
    },
}

ARCHIVE_EXTENSIONS = (
    ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz",
    ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz",
    ".iso", ".z01", ".part1.rar", ".001"
)

def find_portable_7z() -> Optional[str]:
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, "bin", "7z", "7z.exe"),
        os.path.join(base_dir, "bin", "7z.exe"),
        os.path.join(base_dir, "7z.exe"),
        os.path.expanduser(r"~\scoop\shims\7z.exe"),
        r"C:\Program Files\7-Zip\7z.exe",
        r"C:\Program Files (x86)\7-Zip\7z.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return os.path.abspath(path)
    for cmd in ["7z", "7za", "7z.exe"]:
        found = shutil.which(cmd)
        if found:
            return os.path.abspath(found)
    return None

def is_archive(filename: str) -> bool:
    fn = filename.lower()
    return any(fn.endswith(ext) for ext in ARCHIVE_EXTENSIONS)

def delete_archive_and_parts(archive_path: str):
    dir_name = os.path.dirname(archive_path) or "."
    base_name = os.path.basename(archive_path)

    if os.path.exists(archive_path):
        try:
            os.remove(archive_path)
        except Exception:
            pass

    m_part = re.match(r"^(.*?)\.part\d+\.rar$", base_name, re.IGNORECASE)
    if m_part:
        prefix = m_part.group(1).lower()
        for f in os.listdir(dir_name):
            if re.match(rf"^{re.escape(prefix)}\.part\d+\.rar$", f, re.IGNORECASE):
                p = os.path.join(dir_name, f)
                try: os.remove(p)
                except Exception: pass

    m_num = re.match(r"^(.*?)\.\d{3}$", base_name, re.IGNORECASE)
    if m_num:
        prefix = m_num.group(1).lower()
        for f in os.listdir(dir_name):
            if re.match(rf"^{re.escape(prefix)}\.\d{{3}}$", f, re.IGNORECASE):
                p = os.path.join(dir_name, f)
                try: os.remove(p)
                except Exception: pass

    m_zip = re.match(r"^(.*?)\.zip$", base_name, re.IGNORECASE)
    if m_zip:
        prefix = m_zip.group(1).lower()
        for f in os.listdir(dir_name):
            if re.match(rf"^{re.escape(prefix)}\.z\d+$", f, re.IGNORECASE):
                p = os.path.join(dir_name, f)
                try: os.remove(p)
                except Exception: pass


# --- Progress Tracker for Segmented HTTP Downloads ---
class MultiSegmentTracker:
    def __init__(self, app_id: str, total_size: int, game_name: str):
        self.app_id = app_id
        self.total_size = total_size
        self.game_name = game_name
        self.downloaded = 0
        self.start_time = time.time()
        self.last_emit = 0
        self.lock = threading.Lock()
        self.errors = []

    def add(self, count: int):
        with self.lock:
            self.downloaded += count

    def record_error(self, err: str):
        with self.lock:
            self.errors.append(err)

    def monitor(self, stop_event: threading.Event):
        while not stop_event.is_set() and not g_cancelled.is_set():
            time.sleep(0.5)
            with self.lock:
                now = time.time()
                elapsed = max(now - self.start_time, 0.001)
                done = self.downloaded
                speed_bps = int(done / elapsed)
                percent = (done / self.total_size * 100) if self.total_size > 0 else 0.0
                remaining = max(self.total_size - done, 0)
                eta = int(remaining / speed_bps) if speed_bps > 0 else 0

                emit_progress(
                    app_id=self.app_id,
                    phase="downloading",
                    progress_percent=percent,
                    bytes_downloaded=done,
                    total_bytes=self.total_size,
                    speed_bps=speed_bps,
                    eta_seconds=eta,
                    status_text=f"Descargando {self.game_name} ({percent:.1f}%)"
                )


def download_chunk(url: str, start: int, end: int, filepath: str, chunk_id: int, tracker: MultiSegmentTracker, headers: dict, max_retries: int = 3):
    req_headers = dict(headers)
    req_headers['Range'] = f"bytes={start}-{end}"
    req_headers['Accept-Encoding'] = 'identity'

    for attempt in range(max_retries):
        if g_cancelled.is_set():
            return
        try:
            with requests.get(url, headers=req_headers, stream=True, timeout=30) as r:
                if r.status_code not in (200, 206):
                    r.raise_for_status()
                with open(filepath, "r+b") as f:
                    f.seek(start)
                    for chunk in r.iter_content(chunk_size=1024 * 64, decode_unicode=False):
                        wait_if_paused()
                        if g_cancelled.is_set():
                            return
                        if chunk:
                            f.write(chunk)
                            tracker.add(len(chunk))
            return
        except Exception as e:
            if attempt == max_retries - 1:
                tracker.record_error(f"Segment {chunk_id} failed: {e}")
                raise
            time.sleep(1 + attempt)


def download_segmented(url: str, output_path: str, app_id: str, game_name: str, connections: int = 16) -> bool:
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Encoding': 'identity'
    }

    head_resp = requests.head(url, headers=headers, allow_redirects=True, timeout=25)
    head_resp.raise_for_status()
    final_url = head_resp.url
    headers_resp = head_resp.headers

    content_length = headers_resp.get('content-length')
    accept_ranges = headers_resp.get('accept-ranges', '').lower()

    if not content_length:
        # Fallback to single stream
        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
            logger.info("El archivo ya existe. No se puede verificar tamaño (flujo único), se re-descargará.")

        emit_progress(app_id, "downloading", 0.0, 0, 0, 0, 0, f"Descargando {game_name} (flujo único)...")
        with requests.get(final_url, headers=headers, stream=True, timeout=30) as r, open(output_path, 'wb') as f:
            r.raise_for_status()
            downloaded = 0
            start_time = time.time()
            for chunk in r.iter_content(chunk_size=1024 * 64):
                wait_if_paused()
                if g_cancelled.is_set():
                    return False
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    elapsed = max(time.time() - start_time, 0.001)
                    emit_progress(app_id, "downloading", 50.0, downloaded, 0, int(downloaded / elapsed), 0, f"Descargando {game_name}...")
        return True

    total_size = int(content_length)
    if os.path.exists(output_path) and os.path.getsize(output_path) == total_size:
        logger.info(f"El archivo ya está descargado al 100% ({total_size} bytes). Saltando descarga y pasando a extracción.")
        emit_progress(app_id, "downloading", 100.0, total_size, total_size, 0, 0, f"{game_name} ya descargado.")
        return True

    # Check Range support
    if 'bytes' not in accept_ranges and head_resp.status_code != 206:
        test_h = dict(headers)
        test_h['Range'] = 'bytes=0-0'
        t_resp = requests.get(final_url, headers=test_h, stream=True, timeout=10)
        if t_resp.status_code != 206:
            connections = 1

    tracker = MultiSegmentTracker(app_id, total_size, game_name)

    if connections == 1:
        stop_event = threading.Event()
        reporter = threading.Thread(target=tracker.monitor, args=(stop_event,), daemon=True)
        reporter.start()
        with requests.get(final_url, headers=headers, stream=True, timeout=30) as r, open(output_path, 'wb') as f:
            r.raise_for_status()
            for chunk in r.iter_content(chunk_size=1024 * 64):
                wait_if_paused()
                if g_cancelled.is_set():
                    stop_event.set()
                    return False
                if chunk:
                    f.write(chunk)
                    tracker.add(len(chunk))
        stop_event.set()
        reporter.join()
        return True

    # Pre-allocate sparse/zero file
    with open(output_path, "wb") as f:
        f.seek(total_size - 1)
        f.write(b'\0')

    chunk_size = math.ceil(total_size / connections)
    stop_event = threading.Event()
    reporter = threading.Thread(target=tracker.monitor, args=(stop_event,), daemon=True)
    reporter.start()

    threads = []
    for i in range(connections):
        start = i * chunk_size
        end = min(start + chunk_size - 1, total_size - 1)
        if start > end:
            break
        t = threading.Thread(
            target=download_chunk,
            args=(final_url, start, end, output_path, i, tracker, headers)
        )
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    stop_event.set()
    reporter.join()

    if tracker.errors:
        raise RuntimeError(f"Error descargando segmentos: {', '.join(tracker.errors[:3])}")

    return not g_cancelled.is_set()


# --- TorBox API Client ---
class TorboxClient:
    BASE_URL = "https://api.torbox.app/v1/api"

    def __init__(self, api_key: str):
        self.api_key = api_key.strip()
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "User-Agent": "GameAccess/1.0.0"
        })

    def check_cached(self, link_or_hash: str) -> bool:
        url = f"{self.BASE_URL}/torrents/checkcached"
        params = {"format": "list"}
        if link_or_hash.startswith("magnet:"):
            params["link"] = link_or_hash
        else:
            params["hash"] = link_or_hash
        try:
            r = self.session.get(url, params=params, timeout=10)
            if r.ok:
                data = r.json()
                return data.get("data") is True or bool(data.get("data"))
        except Exception:
            pass
        return False

    def add_torrent(self, torrent_input: str) -> int:
        url = f"{self.BASE_URL}/torrents/createentry"
        if torrent_input.startswith("magnet:?"):
            data = {"magnet": torrent_input, "seed": 1, "allow_zip": "true"}
            r = self.session.post(url, data=data, timeout=30)
        elif os.path.isfile(torrent_input):
            with open(torrent_input, "rb") as f:
                files = {"file": (os.path.basename(torrent_input), f, "application/x-bittorrent")}
                data = {"seed": 1, "allow_zip": "true"}
                r = self.session.post(url, data=data, files=files, timeout=60)
        elif torrent_input.startswith("http://") or torrent_input.startswith("https://"):
            data = {"link": torrent_input, "seed": 1, "allow_zip": "true"}
            r = self.session.post(url, data=data, timeout=30)
        else:
            raise ValueError(f"Fuente de torrent inválida: {torrent_input}")

        if not r.ok:
            raise RuntimeError(f"TorBox API error ({r.status_code}): {r.text}")

        res = r.json()
        if not res.get("success"):
            raise RuntimeError(f"TorBox rechazó el torrent: {res.get('detail', res)}")

        return int(res["data"]["torrent_id"])

    def get_status(self, torrent_id: int) -> Optional[Dict[str, Any]]:
        url = f"{self.BASE_URL}/torrents/mylist"
        params = {"id": torrent_id, "bypass_cache": "true"}
        r = self.session.get(url, params=params, timeout=15)
        if not r.ok:
            return None
        res = r.json()
        data = res.get("data")
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict):
            return data
        return None

    def request_link(self, torrent_id: int, file_id: Optional[int] = None, zip_link: bool = True) -> str:
        url = f"{self.BASE_URL}/torrents/requestdl"
        params = {
            "token": self.api_key,
            "torrent_id": torrent_id,
            "zip_link": "true" if zip_link else "false",
            "zip": "true" if zip_link else "false",
        }
        if file_id is not None and not zip_link:
            params["file_id"] = file_id

        r = self.session.get(url, params=params, timeout=30)
        if not r.ok:
            raise RuntimeError(f"No se pudo obtener enlace de descarga de TorBox: {r.status_code}")
        res = r.json()
        link = res.get("data")
        if not link or not isinstance(link, str):
            raise RuntimeError(f"Respuesta de enlace inválida: {res}")
        return link


# --- Direct Torrent Downloader (libtorrent) ---
def download_direct_torrent(
    torrent_source: str,
    dest_dir: str,
    app_id: str,
    game_name: str
) -> str:
    """
    Downloads torrent content directly using libtorrent (matching Hydra's TorrentService).
    Zero technical jargon emitted to the user.
    Returns path of downloaded file or directory.
    """
    global g_torrent_session
    try:
        import libtorrent as lt
    except ImportError:
        raise RuntimeError("El módulo libtorrent no está instalado. Ejecute: pip install libtorrent")

    emit_progress(
        app_id=app_id,
        phase="preparing",
        progress_percent=12.0,
        status_text=f"Conectando con la red para preparar {game_name}..."
    )

    settings = {
        'listen_interfaces': '0.0.0.0:0,[::]:0',
        'enable_dht': True,
        'enable_lsd': True,
        'enable_upnp': True,
        'enable_natpmp': True,
        'alert_mask': lt.alert.category_t.error_notification | lt.alert.category_t.status_notification
    }
    ses = lt.session(settings)
    g_torrent_session = ses

    default_trackers = [
        "udp://tracker.opentrackr.org:1337/announce",
        "udp://open.stealth.si:80/announce",
        "udp://tracker.torrent.eu.org:451/announce",
        "udp://tracker.bittor.pw:1337/announce",
        "udp://public.popcorn-tracker.org:6969/announce",
        "udp://tracker.dler.org:6969/announce",
        "udp://exodus.desync.com:6969/announce",
        "udp://open.demonii.com:1337/announce"
    ]
    dht_bootstrap = [
        ("router.bittorrent.com", 6881),
        ("dht.transmissionbt.com", 6881),
        ("router.utorrent.com", 6881),
        ("dht.libtorrent.org", 25401)
    ]
    
    for host, port in dht_bootstrap:
        ses.add_dht_node((host, port))

    temp_torrent_path = None
    if torrent_source.startswith("magnet:?"):
        params = lt.parse_magnet_uri(torrent_source)
        params.save_path = dest_dir
        existing_trackers = set(getattr(params, "trackers", []))
        for tr in default_trackers:
            existing_trackers.add(tr)
        params.trackers = list(existing_trackers)
        handle = ses.add_torrent(params)
    elif os.path.isfile(torrent_source):
        info = lt.torrent_info(torrent_source)
        params = lt.add_torrent_params()
        params.ti = info
        params.save_path = dest_dir
        existing = {t.url for t in info.trackers()} if hasattr(info, "trackers") else set()
        for tr in default_trackers:
            existing.add(tr)
        params.trackers = list(existing)
        handle = ses.add_torrent(params)
    elif torrent_source.startswith("http://") or torrent_source.startswith("https://"):
        temp_torrent_path = os.path.join(dest_dir, f"{app_id}_temp.torrent")
        g_temp_files.append(temp_torrent_path)
        emit_progress(app_id, "preparing", 14.0, status_text="Descargando manifiesto de instalación...")
        r = requests.get(torrent_source, timeout=30)
        r.raise_for_status()
        with open(temp_torrent_path, "wb") as f:
            f.write(r.content)
        info = lt.torrent_info(temp_torrent_path)
        params = lt.add_torrent_params()
        params.ti = info
        params.save_path = dest_dir
        existing = {t.url for t in info.trackers()} if hasattr(info, "trackers") else set()
        for tr in default_trackers:
            existing.add(tr)
        params.trackers = list(existing)
        handle = ses.add_torrent(params)
    else:
        raise ValueError(f"Fuente de descarga inválida: {torrent_source}")

    def log_libtorrent_alerts(session):
        for alert in session.pop_alerts():
            if alert.category() & lt.alert.category_t.error_notification:
                logger.error(f"[Libtorrent Error] {alert.message()}")
            elif alert.category() & lt.alert.category_t.status_notification:
                logger.info(f"[Libtorrent Status] {alert.message()}")

    # Wait for metadata if necessary (timeout after 45 seconds if no peers/trackers answer)
    meta_start = time.time()
    METADATA_TIMEOUT_SECONDS = 45.0
    while not handle.status().has_metadata:
        wait_if_paused()
        log_libtorrent_alerts(ses)
        if g_cancelled.is_set():
            ses.remove_torrent(handle)
            return ""
        elapsed = time.time() - meta_start
        if elapsed > METADATA_TIMEOUT_SECONDS:
            ses.remove_torrent(handle)
            err_msg = f"No se pudo conectar con las fuentes de descarga para '{game_name}' (sin pares activos disponibles)."
            emit_error(app_id, err_msg)
            raise TimeoutError(err_msg)
        emit_progress(
            app_id=app_id,
            phase="preparing",
            progress_percent=min(14.0 + (elapsed * 0.4), 35.0),
            status_text="Conectando con fuentes de descarga..."
        )
        time.sleep(1)

    tinfo = handle.torrent_file()
    torrent_name = tinfo.name() if tinfo else game_name
    total_wanted = handle.status().total_wanted or (tinfo.total_size() if tinfo else 0)

    target_path = os.path.join(dest_dir, torrent_name)
    g_temp_files.append(target_path)

    emit_progress(
        app_id=app_id,
        phase="downloading",
        progress_percent=0.0,
        bytes_downloaded=0,
        total_bytes=total_wanted,
        status_text=f"Iniciando descarga de {game_name}..."
    )

    last_emit = 0
    while not g_cancelled.is_set():
        wait_if_paused()
        log_libtorrent_alerts(ses)
        s = handle.status()
        progress = s.progress * 100.0
        bytes_done = s.total_wanted_done
        total_bytes = s.total_wanted or total_wanted
        speed = s.download_rate

        remaining = max(total_bytes - bytes_done, 0)
        eta = int(remaining / speed) if speed > 0 else 0

        now = time.time()
        if now - last_emit >= 0.5:
            last_emit = now
            if s.state == lt.torrent_status.checking_files:
                status_text = f"Verificando archivos existentes ({progress:.1f}%)"
            else:
                status_text = f"Descargando {game_name} ({progress:.1f}%)"
                
            emit_progress(
                app_id=app_id,
                phase="downloading",
                progress_percent=progress,
                bytes_downloaded=bytes_done,
                total_bytes=total_bytes,
                speed_bps=speed,
                eta_seconds=eta,
                status_text=status_text
            )

        if s.is_finished or s.state in (lt.torrent_status.finished, lt.torrent_status.seeding) or progress >= 100.0:
            break

        time.sleep(0.5)

    if g_cancelled.is_set():
        ses.remove_torrent(handle)
        return ""

    ses.remove_torrent(handle)
    g_torrent_session = None

    if temp_torrent_path and os.path.exists(temp_torrent_path):
        try: os.remove(temp_torrent_path)
        except Exception: pass

    return target_path


# --- Archive Extraction & Cleaner (Matching Hydra GameFilesManager) ---
def request_archive_passwords():
    """Request central passwords through the desktop bridge, then discard the reply file."""
    reply = LAUNCHER_DIR / ".cache" / "digital_downloads" / f"{g_app_id}.passwords.json"
    emit_json({
        "type": "progress", "appId": str(g_app_id), "phase": "decompressing",
        "progressPercent": 0, "passwordsRequired": True,
        "statusText": "Solicitando contraseñas al servidor..."
    })
    deadline = time.monotonic() + 30
    while not g_cancelled.is_set() and time.monotonic() < deadline:
        try:
            payload = json.loads(reply.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            g_cancelled.wait(0.1)
            continue
        reply.unlink(missing_ok=True)
        if payload.get("error"):
            raise RuntimeError(str(payload["error"]))
        passwords = payload.get("passwords")
        if not isinstance(passwords, list) or any(not isinstance(value, str) for value in passwords):
            raise RuntimeError("La lista de contraseñas del servidor es inválida.")
        return list(dict.fromkeys(value for value in passwords if value))
    if g_cancelled.is_set():
        return []
    raise RuntimeError("El cliente no recibió las contraseñas del servidor. La descarga se conserva.")


def archive_member_names(archive: str, seven_zip: Optional[str], password: str) -> Optional[list[str]]:
    """List incoming payload files without extracting or prompting."""
    import zipfile
    import tarfile
    names = []
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as zf:
            names = [entry.filename for entry in zf.infolist() if not entry.is_dir()]
    elif tarfile.is_tarfile(archive):
        with tarfile.open(archive) as tf:
            names = [entry.name for entry in tf.getmembers() if entry.isfile()]
    elif seven_zip:
        listed = subprocess.run(
            [seven_zip, "l", "-slt", "-ba", os.path.abspath(archive), f"-p{password}"],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=30,
            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {})
        )
        if listed.returncode:
            # An encrypted header will be listed again with the next password.
            return None
        for block in re.split(r"\n\s*\n", listed.stdout):
            fields = dict(line.split(" = ", 1) for line in block.splitlines() if " = " in line)
            if "Path" in fields and fields.get("Folder") != "+" and not fields.get("Attributes", "").startswith("D"):
                names.append(fields["Path"])
    return names


def archive_enclosing_folder(archive: str, seven_zip: Optional[str], password: str) -> Optional[str]:
    """Return the one enclosing folder, or an empty string for loose contents."""
    names = archive_member_names(archive, seven_zip, password)
    if names is None:
        logger.warning(f"No se pudieron leer los archivos dentro de {os.path.basename(archive)}")
        return None
    if not names:
        return ""
    parts = [name.replace("\\", "/").strip("/").split("/") for name in names]
    if any(".." in path or path[0].endswith(":") for path in parts):
        raise RuntimeError("El archivo contiene rutas fuera de la carpeta del juego.")
    first = parts[0][0]
    is_hoisted = all(len(path) > 1 and path[0] == first for path in parts)
    
    if is_hoisted:
        logger.info(f"Smart Hoisting: ZIP contiene una única carpeta raíz '{first}'. Extrayendo directo al destino.")
        return first
    else:
        logger.info("Smart Hoisting: ZIP contiene archivos sueltos. No se ajustará la ruta de extracción.")
        return ""


def extract_archives_in_path(
    target_path: str,
    dest_dir: str,
    host: Optional[str] = None,
    password: Optional[str] = None,
    delete_archive: bool = True,
    game_name: Optional[str] = None,
    retain_backup: bool = True,
    auto_installed: bool = False
) -> bool:
    """
    Extracts archive files (or archives found inside target directory) using portable 7-Zip,
    with Python zipfile/tarfile fallback.
    If delete_archive is True, removes original compressed archive(s) and volume parts.
    """
    archives_to_extract = []

    if os.path.isfile(target_path) and is_archive(target_path):
        archives_to_extract.append(target_path)
    elif os.path.isdir(target_path):
        for root, _, files in os.walk(target_path):
            for f in files:
                full_path = os.path.join(root, f)
                if is_archive(full_path):
                    fn = f.lower()
                    if (fn.startswith("backup for ") and fn.endswith(".zip")) or re.search(r"_backup(?:\.|$)", fn):
                        continue
                    if re.search(r"\.part(?!0*1\b)\d+\.rar$", fn):
                        continue
                    if re.search(r"\.(?!001\b)\d{3}$", fn):
                        continue
                    if re.search(r"\.z\d+$", fn):
                        continue
                    archives_to_extract.append(full_path)

    if not archives_to_extract:
        return False

    # Treat multipart volumes as one archive; only their first volume is extracted.
    if not auto_installed:
        archives_to_extract.sort(key=lambda path: (-os.path.getsize(path), path.lower()))
        logger.info(f"Modo normal: Se ordenaron {len(archives_to_extract)} archivos por tamaño descendente.")
    else:
        logger.info(f"Modo auto_installed: Se respeta el orden natural de {len(archives_to_extract)} archivos.")
        
    game_subfolder = os.path.abspath(dest_dir)
    seven_zip = find_portable_7z()

    # Determine password
    effective_password = password
    if not effective_password and host:
        host_key = host.strip()
        profile = HOST_PROFILES.get(host_key) or HOST_PROFILES.get(host_key.upper()) or HOST_PROFILES.get(host_key.lower())
        if profile and "password" in profile:
            effective_password = profile["password"]

    passwords = [effective_password] if effective_password else ["-"]
    server_passwords_requested = False

    total = len(archives_to_extract)
    for idx, arc in enumerate(archives_to_extract):
        arc_name = os.path.basename(arc)
        logger.info(f"Iniciando extracción de: {arc_name} ({idx+1}/{total})")
        emit_progress(
            app_id=g_app_id,
            phase="decompressing",
            progress_percent=round((idx / total) * 100.0, 1),
            status_text=f"Organizando archivos de {arc_name} ({idx+1}/{total})..."
        )

        success = False
        if seven_zip:
            attempt = 0
            while attempt < len(passwords):
                candidate_password = passwords[attempt]
                if attempt:
                    emit_progress(
                        app_id=g_app_id, phase="decompressing",
                        progress_percent=(idx / total) * 100,
                        status_text=f"Probando contraseña {attempt+1}/{len(passwords)} para {arc_name}..."
                    )
                enclosing = archive_enclosing_folder(arc, seven_zip, candidate_password)
                extraction_dir = game_subfolder if not auto_installed and idx == total - 1 and total > 1 and enclosing == "" else os.path.abspath(dest_dir)
                if not auto_installed and enclosing and idx == 0 and total > 1:
                    game_subfolder = os.path.join(os.path.abspath(dest_dir), enclosing)
                cmd = [
                    seven_zip, "x", os.path.abspath(arc),
                    f"-o{extraction_dir}", "-y", "-aos" if auto_installed else "-aoa",
                    "-bsp1", "-bso1", "-bse1",
                    f"-p{candidate_password}",
                ]
                # Never allow a hidden password prompt to wait forever.
                global g_active_subprocess
                g_active_subprocess = subprocess.Popen(
                    cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
                    **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {})
                )
                output_tail = ""
                token = ""
                last_percent = -1
                while True:
                    character = g_active_subprocess.stdout.read(1)
                    if not character:
                        break
                    output_tail = (output_tail + character)[-2000:]
                    token = (token + character)[-100:]
                    if character == "%":
                        match = re.search(r"(\d{1,3})%$", token)
                        if match:
                            percent = min(int(match.group(1)), 100)
                            if percent != last_percent:
                                last_percent = percent
                                emit_progress(
                                    app_id=g_app_id, phase="decompressing",
                                    progress_percent=((idx + percent / 100) / total) * 100,
                                    status_text=f"Descomprimiendo {arc_name} ({idx+1}/{total}) · {percent}%"
                                )
                    if character in "\r\n":
                        token = ""
                g_active_subprocess.stdout.close()
                returncode = g_active_subprocess.wait()
                g_active_subprocess = None
                if g_cancelled.is_set():
                    return False
                if returncode != 0:
                    if re.search(r"password|encrypted|contrase", output_tail, re.I):
                        if not server_passwords_requested:
                            server_passwords_requested = True
                            for value in request_archive_passwords():
                                if value not in passwords:
                                    passwords.append(value)
                        if attempt + 1 < len(passwords):
                            attempt += 1
                            continue
                        raise RuntimeError(f"No se pudo descomprimir {arc_name}: ninguna contraseña del servidor funcionó. El archivo requiere una contraseña válida. La descarga se conserva.")
                    raise RuntimeError(f"Error al descomprimir {arc_name}: {output_tail.strip()[-300:]}")
                break
            success = True
        else:
            import zipfile
            import tarfile
            try:
                enclosing = archive_enclosing_folder(arc, None, effective_password or "-")
                extraction_dir = game_subfolder if not auto_installed and idx == total - 1 and total > 1 and enclosing == "" else os.path.abspath(dest_dir)
                if not auto_installed and enclosing and idx == 0 and total > 1:
                    game_subfolder = os.path.join(os.path.abspath(dest_dir), enclosing)
                if zipfile.is_zipfile(arc):
                    with zipfile.ZipFile(arc, 'r') as zf:
                        members = [entry for entry in zf.infolist() if not auto_installed or not os.path.exists(os.path.join(extraction_dir, entry.filename))]
                        zf.extractall(extraction_dir, members=members, pwd=effective_password.encode() if effective_password else None)
                    success = True
                elif tarfile.is_tarfile(arc):
                    with tarfile.open(arc, 'r') as tf:
                        members = [entry for entry in tf.getmembers() if not auto_installed or not os.path.exists(os.path.join(extraction_dir, entry.name))]
                        tf.extractall(extraction_dir, members=members)
                    success = True
            except Exception as e:
                raise RuntimeError(f"Error extrayendo {arc_name}: {e}") from e
            if not success:
                raise RuntimeError(f"No hay un extractor disponible para {arc_name}")

        if success and idx == total - 1 and retain_backup and not auto_installed:
            from digital_backup import DigitalArchiveBackup
            DigitalArchiveBackup.retain(arc, dest_dir, extraction_dir, game_name,
                bool((candidate_password if seven_zip else effective_password) not in (None, "", "-")))
        elif success and delete_archive:
            delete_archive_and_parts(arc)
            if arc in g_temp_files:
                g_temp_files.remove(arc)

    emit_progress(
        app_id=g_app_id,
        phase="decompressing",
        progress_percent=100.0,
        status_text="Archivos organizados y listos."
    )
    return True


# --- Main Orchestration ---
def main():
    global g_active_subprocess, g_temp_files, g_app_id

    parser = argparse.ArgumentParser(
        description="digital_downloader.py: Download & Install Pipeline for Tauri/Rust IPC"
    )
    parser.add_argument("--app-id", "--appId", dest="appId", required=True, help="Application/Game ID (e.g. 1091500)")
    parser.add_argument("-name", "--name", required=True, help="Game/Application Display Name")
    parser.add_argument("--source", "--download-source", dest="download_source", default="", help="Download link or 'auto' to resolve automatically")
    parser.add_argument("--auto-installed", action="store_true", help="Source policy: omit patch backup/reapply rules")
    parser.add_argument("--install-process", default=None, help="Terminal command sequence to execute post-download")
    parser.add_argument("--destination-dir", default=None, help="Destination folder (default: ./games)")
    parser.add_argument("--torbox-key", default=os.getenv("TORBOX_API_KEY", ""), help="TorBox API Key")
    parser.add_argument("--host", default=None, help="Host profile identifier (e.g. 'X' uses password 'zzzz')")
    parser.add_argument("--password", "-P", default=None, help="Custom archive password")
    parser.add_argument("--connections", "-n", type=int, default=16, help="Parallel download connections")
    parser.add_argument("--delete-archive", action="store_true", default=True, help="Delete archive files after extraction")
    parser.add_argument("--keep-archive", action="store_true", help="Keep archive after decompressing")
    parser.add_argument("--extract-only", default=None, help="Retry extraction of an already downloaded file or directory")

    args = parser.parse_args()

    app_id = str(args.appId)
    g_app_id = app_id
    game_name = args.name
    
    logger.info(f"=== INICIANDO DESCARGA: '{game_name}' (AppID: {app_id}) ===")
    
    from digital_storage import DigitalGameStorage
    dest_dir = os.path.abspath(args.destination_dir) if args.destination_dir else str(DigitalGameStorage().register(int(app_id), game_name))
    os.makedirs(dest_dir, exist_ok=True)

    control_file = LAUNCHER_DIR / ".cache" / "digital_downloads" / f"{app_id}.control.json"
    threading.Thread(target=watch_controls, daemon=True).start()

    # Clean any stale status file from previous runs
    try:
        old_status = LAUNCHER_DIR / ".cache" / "digital_downloads" / f"{app_id}.json"
        if old_status.is_file():
            old_status.unlink()
    except Exception:
        pass

    # 1. PHASE: PREPARING
    emit_progress(
        app_id=app_id,
        phase="preparing",
        progress_percent=0.0,
        bytes_downloaded=0,
        total_bytes=0,
        speed_bps=0,
        eta_seconds=0,
        status_text="Preparando instalación y verificando espacio en disco..."
    )

    download_source = (args.download_source or "").strip()
    if not args.extract_only and (not download_source or download_source.lower() == "auto"):
        emit_progress(
            app_id=app_id,
            phase="preparing",
            progress_percent=3.0,
            status_text="Localizando archivos de instalación recomendados..."
        )
        try:
            from digital_source_resolver import DigitalSourceResolver
            resolver = DigitalSourceResolver()
            best = resolver.resolve_best_option(game_name)
            if best and best.get("uri"):
                download_source = best["uri"]
                emit_progress(
                    app_id=app_id,
                    phase="preparing",
                    progress_percent=8.0,
                    status_text=f"Paquete seleccionado: {best.get('title', game_name)} ({best.get('size', '')})"
                )
            else:
                raise RuntimeError(f"No se encontraron servidores disponibles para '{game_name}'.")
        except Exception as err:
            logger.error(f"Fallo resolviendo la fuente: {err}")
            emit_error(app_id, f"No se pudo resolver la fuente de instalación: {err}")
            sys.exit(1)

    if args.extract_only:
        logger.info(f"Modo: Solo extracción. Archivo: {args.extract_only}")
    else:
        logger.info(f"Fuente de descarga configurada: {download_source}")

    download_url = None
    target_filename = None
    target_content_path = os.path.abspath(args.extract_only) if args.extract_only else None
    is_torrent = (
        download_source.startswith("magnet:?") or
        download_source.endswith(".torrent") or
        "torrent" in download_source.lower()
    )

    try:
        if args.extract_only:
            if not os.path.exists(target_content_path):
                raise RuntimeError("No se encontró el archivo descargado para descomprimir.")
        else:
            if is_torrent or not (download_source.startswith("http://") or download_source.startswith("https://")) or ".torrent" in download_source.lower():
                torbox_key = (args.torbox_key or os.getenv("TORBOX_API_KEY", "")).strip()
                use_torbox = False
    
                if torbox_key:
                    logger.info("Tipo de descarga: Red P2P mediante servidor de alta velocidad (Torbox/Boxtop)")
                    try:
                        tb = TorboxClient(torbox_key)
                        emit_progress(app_id, "preparing", 10.0, status_text="Verificando disponibilidad en servidores de alta velocidad...")
    
                        is_cached = tb.check_cached(download_source)
                        if is_cached:
                            emit_progress(app_id, "preparing", 18.0, status_text="Servidor optimizado detectado. Acceso rápido listo.")
    
                        # Submit package to high-speed cloud resolver
                        torrent_id = tb.add_torrent(download_source)
                        emit_progress(app_id, "preparing", 22.0, status_text="Conectando con servidores de descarga rápida...")
    
                        # Poll cloud status until completed/cached (up to 30 attempts)
                        tb_attempts = 0
                        while not g_cancelled.is_set() and tb_attempts < 30:
                            tb_attempts += 1
                            status = tb.get_status(torrent_id)
                            if status:
                                is_finished = status.get("download_finished", False)
                                state = status.get("download_state", "unknown")
                                progress = status.get("progress", 0.0)
                                pct = progress if progress > 1.0 else progress * 100
    
                                emit_progress(
                                    app_id=app_id,
                                    phase="preparing",
                                    progress_percent=min(pct * 0.25 + 22.0, 48.0),
                                    status_text=f"Preparando archivos en servidores de alta velocidad ({pct:.0f}%)..."
                                )
    
                                if is_finished or state in ("completed", "cached") or pct >= 100.0:
                                    raw_files = status.get("files") or []
                                    files = [f for f in raw_files if isinstance(f, dict)]
                                    t_name = status.get("name", "game_package")
    
                                    if len(files) == 1:
                                        f_obj = files[0]
                                        target_filename = f_obj.get("name") or t_name
                                        file_id = f_obj.get("id")
                                        download_url = tb.request_link(torrent_id, file_id=file_id, zip_link=False)
                                    else:
                                        target_filename = f"{t_name}.zip"
                                        download_url = tb.request_link(torrent_id, zip_link=True)
                                    use_torbox = True
                                    break
                            time.sleep(2)
                    except Exception as tb_err:
                        logger.warning(f"Error al conectar con servidor TorBox/Boxtop: {tb_err}")
                        emit_progress(
                            app_id=app_id,
                            phase="preparing",
                            progress_percent=15.0,
                            status_text="Servidor optimizado no disponible. Continuando con descarga directa..."
                        )
                        use_torbox = False
    
                # If TorBox is unavailable or has no key, fall back to direct torrent download
                if not use_torbox or not download_url:
                    logger.info("Tipo de descarga: P2P Torrent/Magnet directo local")
                    target_content_path = download_direct_torrent(
                        torrent_source=download_source,
                        dest_dir=dest_dir,
                        app_id=app_id,
                        game_name=game_name
                    )
                    if not target_content_path or g_cancelled.is_set():
                        cleanup_on_cancel()
                        return
            else:
                logger.info("Tipo de descarga: Descarga directa por HTTP/HTTPS")
                download_url = download_source
                parsed = urlparse(download_url)
                target_filename = os.path.basename(unquote(parsed.path)) or "download.bin"
                
                # Verificar si es un hoster que requiere navegador
                browser_domains = [
                    "gofile.io", "1fichier.com", "pixeldrain.com", "qiwi.gg", 
                    "drive.google.com", "mediafire.com", "mega.nz", "krakenfiles.com", 
                    "buzzheavier.com", "rapidgator.net", "multiup.org", 
                    "uploadhaven.com", "megaup.net", "filemoon.sx", "dodi-repacks",
                    "fitgirl-repacks", "rentry.co", "pastebin.com"
                ]
                
                domain = parsed.netloc.lower()
                if any(d in domain for d in browser_domains):
                    logger.info(f"Hoster web detectado ({domain}). Consultando API del servidor para link directo...")
                    emit_progress(app_id, "downloading", 0, 0, 0, 0, 0, f"Resolviendo enlace de {domain} en servidor...")
                    
                    resolved = False
                    try:
                        api_url = os.environ.get("GAMEACCESS_API_URL", "https://game-access-api.onrender.com").rstrip("/")
                        res = requests.post(
                            f"{api_url}/resolve-download",
                            json={"url": download_url},
                            timeout=15
                        )
                        if res.status_code == 200:
                            data = res.json()
                            if data.get("ok") and data.get("direct_url"):
                                download_url = data["direct_url"]
                                if data.get("headers"):
                                    headers.update(data["headers"])
                                logger.info(f"Resuelto con éxito: {download_url}")
                                resolved = True
                            else:
                                logger.error(f"Fallo al resolver en servidor: {data.get('message')}")
                    except Exception as e:
                        logger.error(f"Error consultando servidor resolver: {e}")
                        
                    if not resolved:
                        logger.info(f"Fallback: Hoster de navegador ({domain}). Abriendo web...")
                        import webbrowser
                        webbrowser.open(download_source)
                        
                        emit_progress(
                            app_id=app_id,
                            phase="completed",
                            progress_percent=100.0,
                            bytes_downloaded=0,
                            total_bytes=0,
                            status_text="Abierto en navegador web. Usa el botón de la página (Servidor ocupado)."
                        )
                        logger.info("=== DESCARGA DERIVADA AL NAVEGADOR EXITOSAMENTE ===")
                        sys.exit(0)
    
            # 2. PHASE: SEGMENTED HTTP DOWNLOADING (If link from TorBox or direct HTTP)
            if download_url:
                out_filepath = os.path.join(dest_dir, target_filename or "download.bin")
                g_temp_files.append(out_filepath)
                target_content_path = out_filepath
    
                emit_progress(
                    app_id=app_id,
                    phase="downloading",
                    progress_percent=0.0,
                    status_text="Iniciando descarga de alta velocidad..."
                )
    
                ok = download_segmented(
                    url=download_url,
                    output_path=out_filepath,
                    app_id=app_id,
                    game_name=game_name,
                    connections=args.connections
                )
    
                if not ok or g_cancelled.is_set():
                    cleanup_on_cancel()
                    return
    
        emit_progress(
            app_id=app_id,
            phase="downloading",
            progress_percent=100.0,
            status_text="Descarga finalizada. Preparando instalación..."
        )

        wait_if_paused()
        if g_cancelled.is_set():
            cleanup_on_cancel()
        # Completed downloads must survive extraction/installation errors or cancellation.
        if target_content_path in g_temp_files:
            g_temp_files.remove(target_content_path)
        # 3. PHASE: DECOMPRESSING / EXTRACTING & CLEANUP
        should_delete_archive = True  # Only the smallest original archive is retained.
        extracted = extract_archives_in_path(
            target_path=target_content_path or dest_dir,
            dest_dir=dest_dir,
            host=args.host,
            password=args.password,
            delete_archive=should_delete_archive,
            game_name=game_name,
            auto_installed=args.auto_installed
        )

        if g_cancelled.is_set():
            cleanup_on_cancel()
        # Digital is portable: extraction is the installation. Never execute installProcess.
        if g_cancelled.is_set():
            cleanup_on_cancel()
        # 5. PHASE: COMPLETED
        final_size = 0
        if target_content_path and os.path.exists(target_content_path):
            if os.path.isfile(target_content_path):
                final_size = os.path.getsize(target_content_path)
            elif os.path.isdir(target_content_path):
                final_size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(target_content_path) for f in fs)

        emit_progress(
            app_id=app_id,
            phase="completed",
            progress_percent=100.0,
            bytes_downloaded=final_size,
            total_bytes=final_size,
            speed_bps=0,
            eta_seconds=0,
            status_text=f"¡{game_name} listo para jugar!"
        )
        logger.info(f"=== DESCARGA COMPLETADA EXITOSAMENTE: '{game_name}' ===")
        sys.exit(0)

    except Exception as e:
        if not g_cancelled.is_set():
            logger.error(f"Error fatal durante la descarga de '{game_name}': {e}", exc_info=True)
        else:
            logger.info(f"Descarga cancelada por el usuario: '{game_name}'")
        cleanup_on_cancel(error_message=None if g_cancelled.is_set() else str(e))

if __name__ == "__main__":
    main()
