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
import os
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import requests

POLL_SECONDS = 2.0
PIECE_ATTEMPTS = 4
MAX_IDLE_SECONDS = 60 * 30       # give up when the server makes no progress for this long
STREAM_CHUNK = 1 << 20
NETWORK_RETRIES = 100            # x NETWORK_RETRY_SECONDS: the server may be restarting
NETWORK_RETRY_SECONDS = 3.0
MAX_RESUMES = 3                  # times the player asks the server to resume a job that stopped
RESUMABLE_ERRORS = {"server_restarted", "server_stopped", "unexpected_error", ""}


class ChunkedDownloadUnavailable(Exception):
    """The server cannot serve this source by pieces; the caller should use the normal download."""


class ChunkedDownloadError(Exception):
    pass


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
    def __init__(self, context, session: ChunkSession, http: Any = None, sleep: Callable[[float], None] = time.sleep):
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
                raise ChunkedDownloadUnavailable(f"el servidor respondió {response.status_code}")
            if response.status_code >= 500 and attempt < NETWORK_RETRIES and not self.context.cancelled.is_set():
                self.sleep(NETWORK_RETRY_SECONDS)
                continue
            if response.status_code >= 400:
                raise ChunkedDownloadError(f"el servidor respondió {response.status_code}")
            return response.json()
        raise ChunkedDownloadError("el servidor no respondió")

    def start(self, source_url: str, item_name: str, file_name: str = "") -> dict:
        return self._call("POST", "/downloads/viking-chunks", json={
            "source_url": source_url, "item_name": item_name, "file_name": file_name,
        })

    def manifest(self, job_id: str) -> dict:
        return self._call("GET", f"/downloads/viking-chunks/{job_id}")

    def piece_link(self, job_id: str, index: int) -> dict:
        return self._call("GET", f"/downloads/viking-chunks/{job_id}/pieces/{index}/link")

    # ------------------------------------------------------------ the download
    def download(self, source_url: str, item_name: str, dest_dir: str, app_id: str, game_name: str) -> str:
        """Download everything into `dest_dir`; return the path to hand to the extractor."""
        context = self.context
        manifest = self.start(source_url, item_name)
        job_id = manifest["job_id"]
        dest = Path(dest_dir)
        dest.mkdir(parents=True, exist_ok=True)
        work = dest / f".ga-pieces-{job_id[:8]}"
        work.mkdir(exist_ok=True)
        state_path = dest / f".ga-state-{job_id[:8]}.json"
        done = self._load_state(state_path, job_id)
        started, base_done = time.time(), 0
        idle_since = time.time()
        files_ready = False
        paths: dict[int, Path] = {}
        created: list[Path] = []
        resumes = 0
        finished = False
        try:
            while not context.cancelled.is_set():
                context.wait_if_paused()
                manifest = self.manifest(job_id)
                if manifest["status"] == "failed" and not any(p["ready"] and p["index"] not in done for p in manifest["pieces"]):
                    # Nothing left to download from a stopped job: ask the server to resume it when that makes sense.
                    if resumes < MAX_RESUMES and (manifest.get("error") or "") in RESUMABLE_ERRORS:
                        resumes += 1
                        self.start(source_url, item_name)
                        self.sleep(POLL_SECONDS)
                        continue
                    raise ChunkedDownloadError(f"el servidor no pudo preparar la descarga ({manifest.get('error') or 'error'})")
                if not manifest["pieces"]:
                    # TorBox is still preparing the source; nothing to download yet.
                    context.emit_progress(app_id, "preparing", 20.0, 0, 0, 0, 0, "Preparando los archivos en el servidor...")
                    self._idle(idle_since)
                    continue
                if not files_ready:
                    paths = self._prepare_files(manifest, dest, item_name, created)
                    files_ready = True
                    base_done = sum(p["size"] for p in manifest["pieces"] if p["index"] in done)
                total = int(manifest["total_bytes"] or sum(p["size"] for p in manifest["pieces"]))
                todo = [p for p in manifest["pieces"] if p["index"] not in done]
                if not todo:
                    finished = True
                    break
                ready = [p for p in todo if p["ready"]]
                if not ready:
                    context.emit_progress(
                        app_id, "downloading", self._percent(done, manifest, total), self._bytes(done, manifest), total, 0, 0,
                        f"Esperando el siguiente fragmento de {game_name}...",
                    )
                    self._idle(idle_since)
                    continue
                idle_since = time.time()
                piece = ready[0]
                self._download_piece(job_id, piece, paths[piece["file_index"]], work, manifest, done, total, app_id, game_name, started, base_done)
                done.add(piece["index"])
                self._save_state(state_path, job_id, done)
        except ChunkedDownloadError:
            self._discard(dest, created, state_path)
            raise
        finally:
            shutil.rmtree(work, ignore_errors=True)
            if finished or context.cancelled.is_set():
                state_path.unlink(missing_ok=True)
        if context.cancelled.is_set():
            self._discard(dest, created, state_path)
            return ""
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

    def _load_state(self, path: Path, job_id: str) -> set[int]:
        try:
            data = json.loads(path.read_text("utf-8"))
            if data.get("job_id") == job_id:
                return {int(i) for i in data.get("done", [])}
        except (OSError, ValueError):
            pass
        return set()

    def _save_state(self, path: Path, job_id: str, done: set[int]) -> None:
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps({"job_id": job_id, "done": sorted(done)}), "utf-8")
        os.replace(temp, path)

    def _download_piece(self, job_id, piece, target: Path, work: Path, manifest, done, total, app_id, game_name, started, base_done) -> None:
        context = self.context
        part = work / f"{piece['index']:04d}.part"
        last_error = "error"
        for attempt in range(1, PIECE_ATTEMPTS + 1):
            if context.cancelled.is_set():
                return
            try:
                link = self.piece_link(job_id, piece["index"])
                digest = hashlib.sha256()
                written = 0
                already = self._bytes(done, manifest)
                with self.http.get(link["url"], stream=True, timeout=60, allow_redirects=True) as response:
                    if response.status_code != 200:
                        raise ChunkedDownloadError(f"descarga rechazada ({response.status_code})")
                    if "text/html" in response.headers.get("content-type", "").lower():
                        raise ChunkedDownloadError("el enlace devolvió una página y no el archivo")
                    with part.open("wb") as handle:
                        for chunk in response.iter_content(chunk_size=STREAM_CHUNK):
                            context.wait_if_paused()
                            if context.cancelled.is_set():
                                return
                            if not chunk:
                                continue
                            handle.write(chunk)
                            digest.update(chunk)
                            written += len(chunk)
                            elapsed = max(time.time() - started, 0.001)
                            got = already + written
                            speed = int((got - base_done) / elapsed)
                            eta = int((total - got) / speed) if speed > 0 else 0
                            context.emit_progress(
                                app_id, "downloading", got / total * 100.0 if total else 0.0, got, total, speed, eta,
                                f"Descargando {game_name} ({got / total * 100.0 if total else 0.0:.1f}%)",
                            )
                if written != piece["size"] or digest.hexdigest() != piece["sha256"]:
                    raise ChunkedDownloadError("el fragmento llegó incompleto o dañado")
                with target.open("r+b") as out:
                    out.seek(int(piece["start"]))
                    with part.open("rb") as source:
                        shutil.copyfileobj(source, out, STREAM_CHUNK)
                part.unlink(missing_ok=True)
                return
            except (requests.RequestException, ChunkedDownloadError, OSError) as exc:
                last_error = str(exc)
                part.unlink(missing_ok=True)
                if attempt < PIECE_ATTEMPTS:
                    self.sleep(1.5 * attempt)
        raise ChunkedDownloadError(f"no se pudo bajar el fragmento {piece['index']}: {last_error}")
