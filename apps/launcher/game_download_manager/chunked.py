"""Downloads a game piece by piece from the GameAccess server (TorBox -> ViKiNG).

The server splits the source into pieces and uploads them one after another. This module asks the
server to start (or join) that job, then downloads every piece as soon as it is ready, checks its
sha256, writes it at its place inside the final file and deletes the temporary piece file at once.
Nothing is left behind: temporary pieces and the resume state are removed when the download ends,
fails or is cancelled (a paused or interrupted download keeps only its state file so it can resume).
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, wait as wait_futures
import os
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import requests

from game_download_manager.link_sealing import SealError, unseal

logger = logging.getLogger("digital_downloader")

POLL_SECONDS = 5.0               # asking the server what is ready while nothing is downloading
INFLIGHT_POLL_SECONDS = 3.0      # and while pieces are downloading (a thousand players must stay cheap for the server)
PIECE_ATTEMPTS = 4
MAX_IDLE_SECONDS = 60 * 30       # give up when the server makes no progress for this long
SPEED_WINDOW_SECONDS = 20.0      # speed and time left are measured over this recent window
STREAM_CHUNK = 1 << 20
DOWNLOADS_IN_PARALLEL = 12       # pieces downloaded at once (GAMEACCESS_CHUNK_DOWNLOADS); ViKiNG caps each connection near 1-8 MB/s
CONNECTIONS = 16                 # connections to ViKiNG at once, all pieces together (GAMEACCESS_CHUNK_CONNECTIONS)
CONNECTIONS_PER_PIECE = 6        # a piece lives on one ViKiNG server, which answers 429 from about 7 connections
MIN_SPLIT_BYTES = 8 << 20        # a range is only split in two when each half keeps at least this much
RANGE_FAILURES = 8               # failed connections a piece tolerates before the whole piece is tried again
NETWORK_RETRIES = 100            # x NETWORK_RETRY_SECONDS: the server may be restarting
NETWORK_RETRY_SECONDS = 3.0
MAX_RESUMES = 3                  # times the player asks the server to resume a job that stopped
MAX_REJOINS = 5                  # times the player asks again after the server lost the job (a restart wipes it)
# Torbox hiccups (a slow answer, a 5xx, a long wait) leave the job failed on the server while Torbox keeps working:
# asking again resumes the same job, which is what a manual retry used to do.
RESUMABLE_ERRORS = {"server_restarted", "server_stopped", "unexpected_error", "",
                    "torbox_timeout", "torbox_unavailable", "torbox_server_error", "torbox_wait_timeout"}
ERROR_WORDS = {
    "torbox_stalled": "Torbox no avanza con esta fuente (nadie la comparte o se estancó)",
    "torbox_download_failed": "Torbox no pudo bajar esta fuente",
    "too_many_files": "la fuente tiene demasiados archivos",
    "server_budget_exhausted": "el servidor llegó a su límite de tráfico del mes",
}


class ChunkedDownloadUnavailable(Exception):
    """The server cannot serve this source by pieces; the caller should use the normal download."""

    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


class ChunkedDownloadError(Exception):
    pass


def describe_wait(detail: dict | None, game_name: str = "") -> str:
    """Plain words for what the server is doing while the first pieces are not ready yet."""
    if not detail or detail.get("stage") != "torbox":
        return "Preparando los archivos en el servidor..."
    progress = float(detail.get("progress") or 0)
    seeds = int(detail.get("seeds") or 0)
    state = str(detail.get("state") or "").lower()
    if progress >= 99.5 or state in ("cached", "completed", "uploading"):
        return "El servidor ya tiene el juego y está armando los fragmentos..."
    extra = f" ({seeds} fuentes)" if seeds else ""
    if progress <= 0 and seeds == 0:
        return "El servidor está buscando fuentes para el juego; si nadie lo comparte puede demorar..."
    speed, eta = int(detail.get("speed") or 0), int(detail.get("eta") or 0)
    more = (f" · {speed / 1_000_000:.1f} MB/s" if speed > 0 else "") + (f" · faltan ~{max(1, eta // 60)} min" if eta > 0 else "")
    return f"El servidor está reuniendo el juego: {progress:.0f}%{extra}{more}"


@dataclass(frozen=True)
class ChunkSession:
    api: str
    token: str
    installation: str

    @staticmethod
    def from_env(raw: str | None) -> "ChunkSession | None":
        try:
            data = json.loads(raw or "")
            session = ChunkSession(str(data["api"]).rstrip("/"), str(data["token"]), str(data["installation"]))
        except (ValueError, KeyError, TypeError):
            return None
        return session if session.api and session.token and session.installation else None


def safe_name(name: str, fallback: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(name or "")).strip(" .")
    return cleaned[:150] or fallback


class ChunkedDownloader:
    def __init__(self, context, session: ChunkSession, http: Any = None, sleep: Callable[[float], None] = time.sleep, parallel: int | None = None):
        self.parallel = max(1, parallel or int(os.getenv("GAMEACCESS_CHUNK_DOWNLOADS") or DOWNLOADS_IN_PARALLEL))
        self.connections = threading.BoundedSemaphore(max(1, int(os.getenv("GAMEACCESS_CHUNK_CONNECTIONS") or CONNECTIONS)))
        self.live: dict[int, int] = {}
        self._links: dict[int, dict] = {}
        self._links_lock = threading.Lock()
        self._batch_links = True
        self.abort = threading.Event()
        self.context = context
        self.session = session
        self.http = http or requests
        self.sleep = sleep

    # ------------------------------------------------------------ server calls
    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.session.token}", "X-GameAccess-Installation": self.session.installation}

    def _call(self, method: str, path: str, **kwargs: Any) -> Any:
        """One server call; a lost connection (server restarting, network blip) is waited out."""
        for attempt in range(1, NETWORK_RETRIES + 1):
            try:
                response = self.http.request(method, f"{self.session.api}{path}", headers=self._headers(), timeout=30, **kwargs)
            except requests.RequestException as exc:
                if attempt == NETWORK_RETRIES or self.context.cancelled.is_set():
                    raise ChunkedDownloadError(f"no se pudo conectar con el servidor: {type(exc).__name__}") from exc
                self.sleep(NETWORK_RETRY_SECONDS)
                continue
            if response.status_code in (401, 402, 403, 404, 422):
                raise ChunkedDownloadUnavailable(f"el servidor respondió {response.status_code}", response.status_code)
            if response.status_code >= 500 and attempt < NETWORK_RETRIES and not self.context.cancelled.is_set():
                self.sleep(NETWORK_RETRY_SECONDS)
                continue
            if response.status_code >= 400:
                raise ChunkedDownloadError(f"el servidor respondió {response.status_code}")
            return response.json()
        raise ChunkedDownloadError("el servidor no respondió")

    def peek(self, source_url: str) -> str:
        """Where the server already holds this source ("viking" or "torbox"), or "" (also when it cannot tell).

        One quick call, no retries: when the server does not answer the player just measures the torrent."""
        try:
            response = self.http.request("POST", f"{self.session.api}/downloads/viking-chunks/peek", headers=self._headers(),
                                         timeout=20, json={"source_url": source_url})
            if response.status_code != 200:
                return ""
            body = response.json()
            return str(body.get("where") or "") if body.get("ready") else ""
        except (requests.RequestException, ValueError, AttributeError):
            return ""

    def start(self, source_url: str, item_name: str, file_name: str = "", have: Any = ()) -> dict:
        """Start, join or resume the job; `have` are the pieces already on disk, which the server does not upload again."""
        return self._call("POST", "/downloads/viking-chunks", json={
            "source_url": source_url, "item_name": item_name, "file_name": file_name, "have_pieces": sorted(have),
        })

    def manifest(self, job_id: str) -> dict:
        return self._call("GET", f"/downloads/viking-chunks/{job_id}")

    def piece_link(self, job_id: str, index: int, refresh: bool = False) -> dict:
        """A link for one piece; links are asked for in batches (one server call for many pieces).

        `refresh` says the last link did not work, so the server must hand out a new one."""
        with self._links_lock:
            link = self._links.pop(index, None)
        if link is not None and not refresh:
            return link
        if self._batch_links:
            try:
                count = 1 if refresh else self.parallel * 2
                got = self._call("GET", f"/downloads/viking-chunks/{job_id}/links?start={index}&count={count}" + ("&refresh=true" if refresh else ""))
                with self._links_lock:
                    for item in got.get("links", []):
                        self._links[item["index"]] = item
                    link = self._links.pop(index, None)
                if link is not None:
                    return link
            except ChunkedDownloadUnavailable:
                self._batch_links = False  # an older server: one call per piece, as before
        return self._call("GET", f"/downloads/viking-chunks/{job_id}/pieces/{index}/link" + ("?refresh=true" if refresh else ""))

    # ------------------------------------------------------------ the download
    def download(self, source_url: str, item_name: str, dest_dir: str, app_id: str, game_name: str) -> str:
        """Download everything into `dest_dir`; return the path to hand to the extractor."""
        context = self.context
        dest = Path(dest_dir)
        dest.mkdir(parents=True, exist_ok=True)
        source_key = hashlib.sha1(source_url.encode("utf-8")).hexdigest()[:12]
        state_path = dest / f".ga-state-{source_key}.json"
        # The state belongs to the source, not to the server's job: a server that lost the job makes a new one.
        done, saved_plan = self._load_state(state_path, source_url)
        manifest = self.start(source_url, item_name, have=done)
        job_id = manifest["job_id"]
        reporter = getattr(context, "reporter", None)
        if reporter is not None:  # from here on the player's reports join the server's story of this job
            reporter.job_id = job_id
            reporter.send("started")
        work = dest / f".ga-pieces-{source_key}"
        work.mkdir(exist_ok=True)
        check_plan = bool(done)
        rejoins = 0
        started = time.time()
        idle_since = last_poll = 0.0
        files_ready = False
        paths: dict[int, Path] = {}
        created: list[Path] = []
        resumes = 0
        finished = False
        inflight: dict[Any, int] = {}
        sizes: dict[int, tuple] = {}  # index -> (file, start, size)
        total = 0
        base_done = 0
        last_emit = 0.0
        last_report = 0.0
        samples: deque[tuple[float, int]] = deque()
        self.abort.clear()
        self.live.clear()
        pool = ThreadPoolExecutor(max_workers=self.parallel)
        try:
            while not context.cancelled.is_set():
                context.wait_if_paused()
                lost = False
                for future in [f for f in inflight if f.done()]:
                    index = inflight.pop(future)
                    self.live.pop(index, None)
                    try:
                        future.result()  # raises the piece's error
                    except ChunkedDownloadUnavailable as exc:
                        if exc.status != 404:
                            raise
                        lost = True  # the server no longer knows the job
                        continue
                    done.add(index)
                    self._save_state(state_path, source_url, job_id, done, sizes)
                if files_ready and not inflight and len(done) >= len(sizes):
                    finished = True
                    break
                polled = False
                if len(inflight) < self.parallel:
                    now = time.time()
                    if last_poll == 0.0 or now - last_poll >= (INFLIGHT_POLL_SECONDS if inflight else POLL_SECONDS):
                        last_poll, polled = now, True
                        try:
                            manifest = self.manifest(job_id)
                        except ChunkedDownloadUnavailable as exc:
                            if exc.status != 404:
                                raise
                            lost, polled = True, False
                if lost:
                    # A restarted server forgets its jobs: ask again with the pieces already on disk. The piece that
                    # was half done and every later one come from the new job.
                    if rejoins >= MAX_REJOINS:
                        raise ChunkedDownloadError("el servidor perdió la descarga varias veces")
                    rejoins += 1
                    self._drop_inflight(inflight)
                    manifest = self.start(source_url, item_name, have=done)
                    logger.info("El servidor ya no tenía el trabajo %s; se retoma como %s con %s piezas ya bajadas.",
                                job_id[:8], manifest["job_id"][:8], len(done))
                    job_id, check_plan, last_poll = manifest["job_id"], True, 0.0
                    self._save_state(state_path, source_url, job_id, done, sizes)
                    continue
                if polled:
                    ready_left = any(p["ready"] and p["index"] not in done and p["index"] not in inflight.values() for p in manifest["pieces"])
                    waiting_for = [p for p in manifest["pieces"] if p["index"] not in done and not p["ready"]]
                    stopped = manifest["status"] == "failed" or (manifest["status"] == "partial" and waiting_for)
                    if stopped and not ready_left and not inflight:
                        # Nothing left to download from a stopped job: ask the server to resume it when that makes sense
                        # ("partial": it skipped pieces another player already had, and this one needs them).
                        if resumes < MAX_RESUMES and (manifest.get("error") or "") in RESUMABLE_ERRORS:
                            resumes += 1
                            self.start(source_url, item_name, have=done)
                            self.sleep(POLL_SECONDS)
                            last_poll = 0.0
                            continue
                        code = manifest.get("error") or "error"
                        raise ChunkedDownloadError(f"el servidor no pudo preparar la descarga: {ERROR_WORDS.get(code, code)} ({code})")
                    if not manifest["pieces"]:
                        detail = manifest.get("detail") or {}
                        # The bar follows what Torbox reports (never 0: the job did start).
                        waiting = max(1.0, min(99.0, float(detail.get("progress") or 0))) if detail.get("stage") == "torbox" else 20.0
                        context.emit_progress(app_id, "preparing", waiting, 0, 0, int(detail.get("speed") or 0), int(detail.get("eta") or 0),
                                              describe_wait(detail, game_name))
                        if detail.get("stage") == "torbox" and float(detail.get("progress") or 0) > 0:
                            idle_since = time.time()  # Torbox is moving: the server is not stuck
                        self._idle(idle_since or started)
                        continue
                    if check_plan:
                        # Pieces kept from before are only valid if the server planned the same pieces again.
                        check_plan = False
                        plan = {p["index"]: (p["file_index"], p["start"], int(p["size"])) for p in manifest["pieces"]}
                        known = saved_plan or sizes
                        if any(plan.get(i) != known.get(i) for i in done):
                            logger.info("El servidor armó otras piezas; se vuelven a bajar las %s que había.", len(done))
                            done.clear()
                        saved_plan = {}
                        files_ready = False
                    if not files_ready:
                        paths = self._prepare_files(manifest, dest, item_name, created)
                        files_ready = True
                        sizes = {p["index"]: (p["file_index"], p["start"], int(p["size"])) for p in manifest["pieces"]}
                        total = int(manifest["total_bytes"] or sum(v[2] for v in sizes.values()))
                        base_done = sum(sizes[i][2] for i in done if i in sizes)
                    todo = [p for p in manifest["pieces"] if p["index"] not in done]
                    if not todo:
                        finished = True
                        break
                    taken = set(inflight.values())
                    for piece in [p for p in todo if p["ready"] and p["index"] not in taken][: self.parallel - len(inflight)]:
                        idle_since = time.time()
                        future = pool.submit(self._download_piece, job_id, piece, paths[piece["file_index"]], work)
                        inflight[future] = piece["index"]
                if inflight:
                    self.sleep(0.25)
                elif polled:
                    self._idle(idle_since or started)
                else:
                    self.sleep(0.25)
                if time.time() - last_emit >= 0.5 and files_ready:
                    last_emit = time.time()
                    got = sum(sizes[i][2] for i in done if i in sizes) + sum(self.live.values())
                    if last_emit - last_report >= 15:
                        last_report = last_emit
                        ready_now = sum(1 for p in manifest["pieces"] if p["ready"] and p["index"] not in done)
                        busy = ", ".join(f"#{i} {self.live.get(i, 0) >> 20}/{sizes.get(i, (0, 0, 0))[2] >> 20} MB" for i in sorted(inflight.values()))
                        logger.info("Piezas: %s completas, %s bajando, %s listas en el servidor (sin bajar), %s en total%s",
                                    len(done), len(inflight), ready_now - len(inflight), len(manifest["pieces"]),
                                    f" [{busy}]" if busy else "")
                    # Speed and time left come from the last few seconds, not from the whole download:
                    # an average since the start keeps saying "fast" while the last big piece crawls.
                    samples.append((last_emit, got))
                    while len(samples) > 2 and last_emit - samples[0][0] > SPEED_WINDOW_SECONDS:
                        samples.popleft()
                    span = last_emit - samples[0][0]
                    speed = int(max(got - samples[0][1], 0) / span) if span >= 2.0 else 0
                    eta = int((total - got) / speed) if speed > 0 else 0
                    if inflight:
                        context.emit_progress(app_id, "downloading", got / total * 100.0 if total else 0.0, got, total, speed, eta,
                                              f"Descargando {game_name} ({got / total * 100.0 if total else 0.0:.1f}%)")
                    else:
                        context.emit_progress(app_id, "downloading", got / total * 100.0 if total else 0.0, got, total, 0, 0,
                                              f"Esperando el siguiente fragmento de {game_name}...")
        except ChunkedDownloadError:
            self.abort.set()
            pool.shutdown(wait=True, cancel_futures=True)
            self._discard(dest, created, state_path)
            raise
        finally:
            if not finished:
                self.abort.set()
            pool.shutdown(wait=True, cancel_futures=True)
            shutil.rmtree(work, ignore_errors=True)
            if finished or context.cancelled.is_set():
                state_path.unlink(missing_ok=True)
        if context.cancelled.is_set():
            self._discard(dest, created, state_path)
            return ""
        context.emit_progress(app_id, "downloading", 100.0, total, total, 0, 0, f"Descarga de {game_name} completa.")
        ordered = [paths[i] for i in sorted(paths)]
        if len(ordered) == 1:
            return str(ordered[0])
        return str(ordered[0].parent)

    @staticmethod
    def _discard(dest: Path, created: list[Path], state_path: Path) -> None:
        """Remove what this run created: a cancelled or failed download must leave no files."""
        for path in created:
            path.unlink(missing_ok=True)
        for folder in {p.parent for p in created} - {dest}:
            try:
                folder.rmdir()
            except OSError:
                pass
        state_path.unlink(missing_ok=True)

    def _idle(self, since: float) -> None:
        if time.time() - since > MAX_IDLE_SECONDS:
            raise ChunkedDownloadError("el servidor tardó demasiado en preparar el siguiente fragmento")
        self.sleep(POLL_SECONDS)

    @staticmethod
    def _bytes(done: set[int], manifest: dict) -> int:
        return sum(p["size"] for p in manifest["pieces"] if p["index"] in done)

    def _percent(self, done: set[int], manifest: dict, total: int) -> float:
        return (self._bytes(done, manifest) / total * 100.0) if total > 0 else 0.0

    def _prepare_files(self, manifest: dict, dest: Path, item_name: str, created: list[Path]) -> dict[int, Path]:
        files = manifest["files"]
        folder = dest if len(files) == 1 else dest / safe_name(item_name or manifest.get("item_name"), "juego")
        folder.mkdir(parents=True, exist_ok=True)
        paths: dict[int, Path] = {}
        for entry in files:
            relative = safe_name(entry["name"].replace("\\", "/").split("/")[-1], f"archivo-{entry['index']}")
            path = folder / relative
            if not path.exists():
                created.append(path)
                with path.open("wb") as handle:
                    if entry["size"] > 0:
                        handle.truncate(int(entry["size"]))
            paths[int(entry["index"])] = path
        return paths

    def _load_state(self, path: Path, source_url: str) -> tuple[set[int], dict[int, tuple]]:
        """The pieces already on disk for this source, with the plan they belong to (index -> file, start, size)."""
        try:
            data = json.loads(path.read_text("utf-8"))
            if data.get("source") == hashlib.sha1(source_url.encode("utf-8")).hexdigest():
                plan = {int(k): tuple(v) for k, v in (data.get("plan") or {}).items()}
                return {int(i) for i in data.get("done", []) if int(i) in plan}, plan
        except (OSError, ValueError, TypeError):
            pass
        return set(), {}

    def _save_state(self, path: Path, source_url: str, job_id: str, done: set[int], plan: dict[int, tuple]) -> None:
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps({
            "source": hashlib.sha1(source_url.encode("utf-8")).hexdigest(), "job_id": job_id, "done": sorted(done),
            "plan": {str(i): list(v) for i, v in plan.items()},
        }), "utf-8")
        os.replace(temp, path)

    def _drop_inflight(self, inflight: dict[Any, int]) -> None:
        """Stop the pieces being downloaded (none of them counts as done) and forget the links of the old job."""
        self.abort.set()
        wait_futures(list(inflight))
        inflight.clear()
        self.live.clear()
        self.abort.clear()
        with self._links_lock:
            self._links.clear()

    def _open_link(self, link: dict) -> str:
        """The URL to download: a TorBox link arrives sealed for this session and is opened only in memory."""
        if link.get("sealed"):
            try:
                return unseal(link["sealed"], self.session.token, self.session.installation)
            except SealError as exc:
                raise ChunkedDownloadError("el enlace no se pudo abrir") from exc
        return link["url"]

    def _download_piece(self, job_id: str, piece: dict, target: Path, work: Path) -> None:
        """Runs in a worker thread: download one piece, verify it and write it at its place."""
        context = self.context
        index = piece["index"]
        part = work / f"{index:04d}.part"
        last_error = "error"
        for attempt in range(1, PIECE_ATTEMPTS + 1):
            if context.cancelled.is_set() or self.abort.is_set():
                return
            try:
                link = self.piece_link(job_id, index, refresh=attempt > 1)  # a retry means the link did not work
                url = self._open_link(link)
                # Only the host: a TorBox link carries the account's key and must never reach a log.
                logger.info("Pieza %s: desde %s (%s)", index, link.get("source") or "viking", requests.utils.urlparse(url).hostname)
                piece_started = time.time()
                self.live[index] = 0
                if not piece.get("sha256"):
                    # A whole file ViKiNG imported by itself: the server never saw its bytes, so there is no hash
                    # to check (the archive's own checksums are checked when it is extracted). It goes straight
                    # into its place: a file of several GB is not copied a second time.
                    peak, written = self._fetch_piece(url, piece, target, offset=int(piece["start"]))
                    if context.cancelled.is_set() or self.abort.is_set():
                        return
                    if written != piece["size"]:
                        raise ChunkedDownloadError("el archivo llegó incompleto")
                    took = max(time.time() - piece_started, 0.001)
                    logger.info("Archivo %s: %.0f MB en %.0f s = %.1f MB/s con hasta %s conexiones (%s a la vez)",
                                index, written / 1048576, took, written / 1048576 / took, peak, len(self.live))
                    return
                peak, _ = self._fetch_piece(url, piece, part)
                if context.cancelled.is_set() or self.abort.is_set():
                    return
                digest = hashlib.sha256()
                with part.open("rb") as handle:
                    for block in iter(lambda: handle.read(STREAM_CHUNK), b""):
                        digest.update(block)
                written = part.stat().st_size
                if written != piece["size"] or digest.hexdigest() != piece["sha256"]:
                    raise ChunkedDownloadError("el fragmento llegó incompleto o dañado")
                took = max(time.time() - piece_started, 0.001)
                logger.info("Pieza %s: %.0f MB en %.0f s = %.1f MB/s con hasta %s conexiones (%s piezas a la vez)",
                            index, written / 1048576, took, written / 1048576 / took, peak, len(self.live))
                with target.open("r+b") as out:
                    out.seek(int(piece["start"]))
                    with part.open("rb") as source:
                        shutil.copyfileobj(source, out, STREAM_CHUNK)
                part.unlink(missing_ok=True)
                return
            except (requests.RequestException, ChunkedDownloadError, OSError) as exc:
                last_error = str(exc) or type(exc).__name__
                logger.warning("Pieza %s: intento %s de %s fallo (%s)%s", index, attempt, PIECE_ATTEMPTS, last_error,
                               "; se reintenta" if attempt < PIECE_ATTEMPTS else "")
                self.live[index] = 0
                part.unlink(missing_ok=True)
                if attempt < PIECE_ATTEMPTS:
                    self.sleep(1.5 * attempt)
        raise ChunkedDownloadError(f"no se pudo bajar el fragmento {index}: {last_error}")

    def _fetch_piece(self, url: str, piece: dict, part: Path, offset: int | None = None) -> tuple[int, int]:
        """Download one piece into `part` over several range connections; return the most connections used at
        once and the bytes written. With `offset` the bytes go into `part` (the final file) from there on.

        A piece starts on one connection. Once ViKiNG shows it honours ranges, every free connection takes half of
        the largest range still left, so a slow connection keeps handing its bytes to faster ones (the last piece
        no longer crawls on one slow connection). A server that ignores ranges sends the piece on one connection."""
        context = self.context
        index, size = piece["index"], int(piece["size"])
        if offset is None:
            with part.open("wb") as handle:
                handle.truncate(size)
        ranges: list[list[int]] = [[0, size - 1, 0]]   # start, end (inclusive), written
        owned: set[int] = set()                         # ranges a connection is working on
        lock = threading.Lock()
        ranged = threading.Event()
        stop = threading.Event()
        errors: list[Exception] = []
        threads: list[threading.Thread] = []
        cap, failures, peak = CONNECTIONS_PER_PIECE, 0, 0

        def left(r: list[int]) -> int:
            return r[1] - (r[0] + r[2]) + 1

        def run(slot: int) -> None:
            try:
                self._fetch_range(url, ranges[slot], part, lock, ranged, stop, index, ranges, offset or 0)
            except BaseException as exc:  # noqa: BLE001 - reported to the piece, which retries the range
                with lock:
                    errors.append(exc)
            finally:
                with lock:
                    owned.discard(slot)
                self.connections.release()

        def free_range() -> int | None:
            """A range no connection is working on (not started yet, or its connection failed)."""
            return next((i for i, r in enumerate(ranges) if left(r) > 0 and i not in owned), None)

        def split() -> int | None:
            """Hand the second half of the largest range being downloaded to a new connection."""
            largest = max(owned, key=lambda i: left(ranges[i]), default=None)
            if not ranged.is_set() or largest is None or left(ranges[largest]) < 2 * MIN_SPLIT_BYTES:
                return None
            r = ranges[largest]
            middle = r[0] + r[2] + left(r) // 2
            ranges.append([middle, r[1], 0])
            r[1] = middle - 1
            return len(ranges) - 1

        last: Exception | None = None
        try:
            while not (context.cancelled.is_set() or self.abort.is_set()):
                with lock:
                    threads = [t for t in threads if t.is_alive()]
                    if not owned and all(left(r) <= 0 for r in ranges):
                        break
                    fatal = next((exc for exc in errors if not isinstance(exc, Exception)), None)
                    if fatal is not None:
                        raise fatal  # the app is closing (KeyboardInterrupt, SystemExit): not a network error to retry
                    for exc in errors:
                        failures, last = failures + 1, exc
                        if "429" in str(exc):
                            cap = max(1, len(owned))  # ViKiNG wants fewer connections on this server
                    errors.clear()
                    if failures > RANGE_FAILURES:
                        raise ChunkedDownloadError(f"conexiones fallidas: {last}")
                    wants = len(owned) < cap
                    alone = not owned
                # The first connection waits for a free slot; more connections are added only when one is free.
                if wants and self.connections.acquire(timeout=0.25 if alone else 0.001):
                    with lock:
                        slot = free_range()
                        if slot is None:
                            slot = split()
                        if slot is not None:
                            owned.add(slot)
                            peak = max(peak, len(owned))
                    if slot is None:
                        self.connections.release()
                    else:
                        thread = threading.Thread(target=run, args=(slot,), daemon=True)
                        threads.append(thread)
                        thread.start()
                        continue
                stop.wait(0.05)
        finally:
            stop.set()  # connections still running (cancel, error) stop at their next block
            for thread in threads:
                thread.join()
        return peak, sum(r[2] for r in ranges)

    def _fetch_range(self, url: str, r: list[int], part: Path, lock: threading.Lock, ranged: threading.Event,
                     stop: threading.Event, index: int, ranges: list[list[int]], offset: int = 0) -> None:
        """One connection: download bytes r[0]+r[2]..r[1] of the piece. The end may move closer while it runs
        (another connection took the second half); it stops there."""
        context = self.context
        with lock:
            position, end = r[0] + r[2], r[1]
        if position > end:
            return
        headers = {"Range": f"bytes={position}-{end}", "Accept-Encoding": "identity"}
        with self.http.get(url, stream=True, timeout=60, allow_redirects=True, headers=headers) as response:
            if response.status_code == 429:
                raise ChunkedDownloadError("demasiadas conexiones (429)")
            if response.status_code == 206:
                if not str(response.headers.get("content-range", "")).lower().startswith(f"bytes {position}-"):
                    raise ChunkedDownloadError("el servidor no respetó el rango pedido")
                ranged.set()
            elif response.status_code != 200 or position != 0:
                raise ChunkedDownloadError(f"descarga rechazada ({response.status_code})")
            if "text/html" in response.headers.get("content-type", "").lower():
                raise ChunkedDownloadError("el enlace devolvió una página y no el archivo")
            with part.open("r+b") as handle:
                for chunk in response.iter_content(chunk_size=STREAM_CHUNK):
                    context.wait_if_paused()
                    if context.cancelled.is_set() or self.abort.is_set() or stop.is_set():
                        return
                    if not chunk:
                        continue
                    with lock:
                        at = r[0] + r[2]
                        take = chunk[: max(r[1] - at + 1, 0)]
                        r[2] += len(take)
                        finished = r[0] + r[2] > r[1]
                        self.live[index] = sum(x[2] for x in ranges)
                    if take:
                        handle.seek(offset + at)
                        handle.write(take)
                    if finished:
                        return
        with lock:
            complete = r[0] + r[2] > r[1]
        if not complete:
            raise ChunkedDownloadError("la conexión se cortó antes de terminar")
