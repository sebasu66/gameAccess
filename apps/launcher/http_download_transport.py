"""HTTP streaming/range transport and segment progress accounting."""
from __future__ import annotations
import os
import re
import time
import math
import threading
import requests
from download_source_validation import validate_http_file_response

class MultiSegmentTracker:
    def __init__(self, context, app_id: str, total_size: int, game_name: str):
        self.context = context
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
        while not stop_event.is_set() and not self.context.cancelled.is_set():
            time.sleep(0.5)
            with self.lock:
                now = time.time()
                elapsed = max(now - self.start_time, 0.001)
                done = self.downloaded
                speed_bps = int(done / elapsed)
                percent = (done / self.total_size * 100) if self.total_size > 0 else 0.0
                remaining = max(self.total_size - done, 0)
                eta = int(remaining / speed_bps) if speed_bps > 0 else 0

                self.context.emit_progress(
                    app_id=self.app_id,
                    phase="downloading",
                    progress_percent=percent,
                    bytes_downloaded=done,
                    total_bytes=self.total_size,
                    speed_bps=speed_bps,
                    eta_seconds=eta,
                    status_text=f"Descargando {self.game_name} ({percent:.1f}%)"
                )


class HttpDownloadTransport:
    def __init__(self, context):
        self.context = context

    def download_chunk(self, url: str, start: int, end: int, filepath: str, chunk_id: int, tracker: MultiSegmentTracker, headers: dict, max_retries: int = 3):
        context = self.context
        context.logger.debug("HTTP segment=%s range=%s-%s", chunk_id, start, end)
        req_headers = dict(headers)
        req_headers['Range'] = f"bytes={start}-{end}"
        req_headers['Accept-Encoding'] = 'identity'

        for attempt in range(max_retries):
            if context.cancelled.is_set():
                return
            try:
                with requests.get(url, headers=req_headers, stream=True, timeout=30) as r:
                    if r.status_code not in (200, 206):
                        r.raise_for_status()
                    validate_http_file_response(r)
                    if r.status_code != 206 or not r.headers.get('content-range', '').lower().startswith(f'bytes {start}-'):
                        raise RuntimeError('El proveedor no respetó el rango solicitado; se ha detenido la descarga.')
                    with open(filepath, "r+b") as f:
                        f.seek(start)
                        for chunk in r.iter_content(chunk_size=1024 * 64, decode_unicode=False):
                            context.wait_if_paused()
                            if context.cancelled.is_set():
                                return
                            if chunk:
                                f.write(chunk)
                                tracker.add(len(chunk))
                return
            except Exception as e:
                context.logger.debug("HTTP segment=%s attempt=%s failed: %s", chunk_id, attempt + 1, e)
                if attempt == max_retries - 1:
                    tracker.record_error(f"Segment {chunk_id} failed: {e}")
                    raise
                time.sleep(1 + attempt)


    def download_segmented(self, url: str, output_path: str, app_id: str, game_name: str, connections: int = 16) -> bool:
        context = self.context
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Encoding': 'identity'
        }

        # GET is authoritative: several file hosts reject HEAD or return an HTML page for it.
        with requests.get(url, headers={**headers, 'Range': 'bytes=0-511'}, stream=True, timeout=25) as probe:
            validate_http_file_response(probe, inspect_body=True)
            context.logger.debug("HTTP probe status=%s content_type=%s range=%s", probe.status_code, probe.headers.get("content-type"), probe.headers.get("content-range"))
            final_url = probe.url
            headers_resp = probe.headers
            content_range = headers_resp.get('content-range', '')
            if probe.status_code == 206:
                match = re.fullmatch(r'bytes 0-\d+/(\d+)', content_range, re.I)
                if not match:
                    raise RuntimeError("El proveedor devolvió un rango de archivo inválido.")
                content_length = match.group(1)
                accept_ranges = 'bytes'
            else:
                content_length = headers_resp.get('content-length')
                accept_ranges = headers_resp.get('accept-ranges', '').lower()

        if not content_length:
            # Fallback to single stream
            if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                context.logger.info("El archivo ya existe. No se puede verificar tamaño (flujo único), se re-descargará.")

            context.emit_progress(app_id, "downloading", 0.0, 0, 0, 0, 0, f"Descargando {game_name} (flujo único)...")
            with requests.get(final_url, headers=headers, stream=True, timeout=30) as r, open(output_path, 'wb') as f:
                validate_http_file_response(r)
                downloaded = 0
                start_time = time.time()
                for chunk in r.iter_content(chunk_size=1024 * 64):
                    context.wait_if_paused()
                    if context.cancelled.is_set():
                        return False
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)
                        elapsed = max(time.time() - start_time, 0.001)
                        context.emit_progress(app_id, "downloading", 50.0, downloaded, 0, int(downloaded / elapsed), 0, f"Descargando {game_name}...")
            return True

        total_size = int(content_length)
        if os.path.exists(output_path) and os.path.getsize(output_path) == total_size:
            context.logger.info(f"El archivo ya está descargado al 100% ({total_size} bytes). Saltando descarga y pasando a extracción.")
            context.emit_progress(app_id, "downloading", 100.0, total_size, total_size, 0, 0, f"{game_name} ya descargado.")
            return True

        # Check Range support
        if 'bytes' not in accept_ranges:
            test_h = dict(headers)
            test_h['Range'] = 'bytes=0-0'
            t_resp = requests.get(final_url, headers=test_h, stream=True, timeout=10)
            try:
                validate_http_file_response(t_resp)
                if t_resp.status_code != 206:
                    connections = 1
            finally:
                t_resp.close()

        tracker = MultiSegmentTracker(context, app_id, total_size, game_name)

        if connections == 1:
            stop_event = threading.Event()
            reporter = threading.Thread(target=tracker.monitor, args=(stop_event,), daemon=True)
            reporter.start()
            with requests.get(final_url, headers=headers, stream=True, timeout=30) as r, open(output_path, 'wb') as f:
                validate_http_file_response(r)
                for chunk in r.iter_content(chunk_size=1024 * 64):
                    context.wait_if_paused()
                    if context.cancelled.is_set():
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
                target=self.download_chunk,
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

        return not context.cancelled.is_set()
