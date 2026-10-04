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

LAUNCHER_DIR = Path(__file__).resolve().parent

# Ensure stdout uses UTF-8 and auto-flushes
if sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Global cancellation and child process tracking
g_cancelled = threading.Event()
g_active_subprocess: Optional[subprocess.Popen] = None
g_temp_files: List[str] = []
g_app_id: str = ""

def emit_json(payload: dict):
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
    emit_json({
        "type": "progress",
        "appId": str(app_id),
        "phase": phase,
        "progressPercent": round(float(progress_percent), 1),
        "bytesDownloaded": int(bytes_downloaded),
        "totalBytes": int(total_bytes),
        "speedBps": int(speed_bps),
        "etaSeconds": int(eta_seconds),
        "statusText": status_text
    })

def emit_error(app_id: str, error_message: str):
    emit_json({
        "type": "error",
        "appId": str(app_id),
        "phase": "error",
        "error": error_message,
        "statusText": f"Error: {error_message}"
    })

def cleanup_on_cancel(signum=None, frame=None):
    """Graceful cleanup handler for SIGINT/SIGTERM."""
    global g_cancelled, g_active_subprocess, g_temp_files, g_app_id
    g_cancelled.set()
    
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

    emit_error(g_app_id, "Proceso cancelado por el usuario")
    sys.exit(130)

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
    final_url = head_resp.url
    headers_resp = head_resp.headers

    content_length = headers_resp.get('content-length')
    accept_ranges = headers_resp.get('accept-ranges', '').lower()

    if not content_length:
        # Fallback to single stream
        emit_progress(app_id, "downloading", 0.0, 0, 0, 0, 0, f"Descargando {game_name} (flujo único)...")
        with requests.get(final_url, headers=headers, stream=True, timeout=30) as r, open(output_path, 'wb') as f:
            downloaded = 0
            start_time = time.time()
            for chunk in r.iter_content(chunk_size=1024 * 64):
                if g_cancelled.is_set():
                    return False
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    elapsed = max(time.time() - start_time, 0.001)
                    emit_progress(app_id, "downloading", 50.0, downloaded, 0, int(downloaded / elapsed), 0, f"Descargando {game_name}...")
        return True

    total_size = int(content_length)

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
            for chunk in r.iter_content(chunk_size=1024 * 64):
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
        self.session.headers.update({"Authorization": f"Bearer {self.api_key}"})

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
        params = {"id": torrent_id}
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

    def request_link(self, torrent_id: int, file_id: Optional[int] = None, zip_link: bool = False) -> str:
        url = f"{self.BASE_URL}/torrents/requestdl"
        params = {
            "token": self.api_key,
            "torrent_id": torrent_id,
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


# --- Main Orchestration ---
def main():
    global g_active_subprocess, g_temp_files, g_app_id

    parser = argparse.ArgumentParser(
        description="digital_downloader.py: Download & Install Pipeline for Tauri/Rust IPC"
    )
    parser.add_argument("--app-id", "--appId", dest="appId", required=True, help="Application/Game ID (e.g. 1091500)")
    parser.add_argument("-name", "--name", required=True, help="Game/Application Display Name")
    parser.add_argument("--source", "--download-source", dest="download_source", default="", help="Download link or 'auto' to resolve automatically")
    parser.add_argument("--install-process", default=None, help="Terminal command sequence to execute post-download")
    parser.add_argument("--destination-dir", default="./games", help="Destination folder (default: ./games)")
    parser.add_argument("--torbox-key", default=os.getenv("TORBOX_API_KEY", ""), help="TorBox API Key")
    parser.add_argument("--host", default=None, help="Host profile identifier (e.g. 'X' uses password 'zzzz')")
    parser.add_argument("--password", "-P", default=None, help="Custom archive password")
    parser.add_argument("--connections", "-n", type=int, default=16, help="Parallel download connections")
    parser.add_argument("--keep-archive", action="store_true", help="Keep archive after decompressing")

    args = parser.parse_args()

    app_id = str(args.appId)
    g_app_id = app_id
    game_name = args.name
    dest_dir = os.path.abspath(args.destination_dir)
    os.makedirs(dest_dir, exist_ok=True)

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
    if not download_source or download_source.lower() == "auto":
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
            emit_error(app_id, f"No se pudo resolver la fuente de instalación: {err}")
            sys.exit(1)

    download_url = None
    target_filename = None
    is_torrent = (
        download_source.startswith("magnet:?") or
        download_source.endswith(".torrent") or
        "torrent" in download_source.lower()
    )

    try:
        if is_torrent or not (download_source.startswith("http://") or download_source.startswith("https://")) or ".torrent" in download_source.lower():
            torbox_key = args.torbox_key
            if not torbox_key:
                raise ValueError("Se requiere TorBox API Key para optimizar la descarga (--torbox-key o TORBOX_API_KEY)")

            tb = TorboxClient(torbox_key)
            emit_progress(app_id, "preparing", 10.0, status_text="Verificando disponibilidad en servidores de alta velocidad...")

            is_cached = tb.check_cached(download_source)
            if is_cached:
                emit_progress(app_id, "preparing", 18.0, status_text="Servidor optimizado detectado. Acceso inmediato listo.")

            # Submit package to high-speed cloud resolver
            torrent_id = tb.add_torrent(download_source)
            emit_progress(app_id, "preparing", 22.0, status_text="Conectando con servidores de descarga rápida...")

            # Poll cloud status until completed/cached
            while not g_cancelled.is_set():
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
                            download_url = tb.request_link(torrent_id, file_id=file_id)
                        else:
                            # Package multi-file content into single archive
                            target_filename = f"{t_name}.zip"
                            download_url = tb.request_link(torrent_id, zip_link=True)
                        break
                time.sleep(2)
        else:
            download_url = download_source
            parsed = urlparse(download_url)
            target_filename = os.path.basename(unquote(parsed.path)) or "download.bin"

        if not download_url:
            raise RuntimeError("No se pudo obtener el enlace de descarga directo.")

        # 2. PHASE: DOWNLOADING
        out_filepath = os.path.join(dest_dir, target_filename)
        g_temp_files.append(out_filepath)

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

        # 3. PHASE: DECOMPRESSING / EXTRACTING
        archive_detected = is_archive(out_filepath)
        extracted_dir = dest_dir

        if archive_detected:
            emit_progress(
                app_id=app_id,
                phase="decompressing",
                progress_percent=0.0,
                status_text="Organizando y verificando archivos del juego..."
            )

            seven_zip = find_portable_7z()
            if not seven_zip:
                raise RuntimeError("No se encontró 7-Zip Portable (bin/7z/7z.exe) para descomprimir")

            # Determine password (e.g. host X -> zzzz)
            effective_password = args.password
            if not effective_password and args.host:
                host_key = args.host.strip()
                profile = HOST_PROFILES.get(host_key) or HOST_PROFILES.get(host_key.upper()) or HOST_PROFILES.get(host_key.lower())
                if profile and "password" in profile:
                    effective_password = profile["password"]

            cmd = [
                seven_zip,
                "x",
                os.path.abspath(out_filepath),
                f"-o{os.path.abspath(dest_dir)}",
                "-y"
            ]
            if effective_password:
                cmd.append(f"-p{effective_password}")

            g_active_subprocess = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            stdout, stderr = g_active_subprocess.communicate()

            if g_active_subprocess.returncode != 0:
                raise RuntimeError(f"Error al organizar archivos (código {g_active_subprocess.returncode}): {stderr.strip() or stdout.strip()[-200:]}")

            emit_progress(
                app_id=app_id,
                phase="decompressing",
                progress_percent=100.0,
                status_text="Archivos del juego preparados correctamente"
            )

            if not args.keep_archive:
                delete_archive_and_parts(out_filepath)
                if out_filepath in g_temp_files:
                    g_temp_files.remove(out_filepath)

        # 4. PHASE: INSTALLING (Optional post-download install command)
        if args.install_process:
            emit_progress(
                app_id=app_id,
                phase="installing",
                progress_percent=0.0,
                status_text=f"Instalando {game_name}..."
            )

            # Context variable substitution
            seven_zip_path = find_portable_7z() or "7z"
            cmd_rendered = args.install_process.format(
                file=out_filepath,
                dest=dest_dir,
                dir=dest_dir,
                appId=app_id,
                name=game_name,
                seven_zip=seven_zip_path,
                _7z=seven_zip_path
            )

            g_active_subprocess = subprocess.Popen(
                cmd_rendered,
                shell=True,
                cwd=dest_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            stdout, stderr = g_active_subprocess.communicate()

            if g_active_subprocess.returncode != 0:
                raise RuntimeError(f"El proceso de instalación falló con código {g_active_subprocess.returncode}: {stderr.strip()[:200]}")

            emit_progress(
                app_id=app_id,
                phase="installing",
                progress_percent=100.0,
                status_text="Instalación completada"
            )

        # 5. PHASE: COMPLETED
        final_size = os.path.getsize(out_filepath) if os.path.exists(out_filepath) else 0
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
        sys.exit(0)

    except Exception as e:
        emit_error(app_id, str(e))
        cleanup_on_cancel()
        sys.exit(1)

if __name__ == "__main__":
    main()
