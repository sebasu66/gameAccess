from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Any, Callable, Iterable

REAL_DEBRID_API = "https://api.real-debrid.com/rest/1.0"
VIKING_API = "https://vikingfile.com/api"
FILEQ_API = "https://fileq.net/api"

StatusCallback = Callable[[dict[str, Any]], None]


class TransferError(RuntimeError):
    """Expected transfer failure with a user-readable message."""


class CancelledError(TransferError):
    pass


def _emit(callback: StatusCallback | None, stage: str, message: str, **extra: Any) -> None:
    if callback:
        callback({"stage": stage, "message": message, **extra})


def _check_cancel(cancel_event: Event | None) -> None:
    if cancel_event and cancel_event.is_set():
        raise CancelledError("Transfer cancelled by user.")


def human_bytes(value: int | float | None) -> str:
    if value is None:
        return "unknown"
    size = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def is_magnet(value: str) -> bool:
    return value.strip().lower().startswith("magnet:?")


def select_file_ids(files: Iterable[dict[str, Any]], mode: str) -> list[int]:
    candidates = [
        f for f in files
        if isinstance(f, dict) and isinstance(f.get("id"), int) and int(f.get("bytes") or 0) > 0
    ]
    if not candidates:
        raise TransferError("Torrent metadata contains no selectable files.")
    if mode == "all":
        return [int(f["id"]) for f in candidates]
    largest = max(candidates, key=lambda f: int(f.get("bytes") or 0))
    return [int(largest["id"])]


@dataclass
class RemoteFile:
    filename: str
    size: int | None
    url: str


@dataclass
class HostedFile:
    filename: str
    url: str
    provider: str


class HttpClient:
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        form: dict[str, Any] | None = None,
        body: bytes | None = None,
        timeout: int = 90,
    ) -> tuple[int, dict[str, str], bytes]:
        req_headers = dict(headers or {})
        data = body
        if form is not None:
            data = urllib.parse.urlencode({k: str(v) for k, v in form.items()}).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        request = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.status, dict(response.headers.items()), response.read()
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            detail = payload.decode("utf-8", errors="replace").strip()
            try:
                parsed = json.loads(detail)
                detail = str(parsed.get("error") or parsed.get("msg") or detail)
            except Exception:
                pass
            raise TransferError(f"HTTP {exc.code} from {urllib.parse.urlsplit(url).netloc}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise TransferError(f"Network error contacting {urllib.parse.urlsplit(url).netloc}: {exc.reason}") from exc

    def json(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        _status, _headers, body = self.request(method, url, **kwargs)
        try:
            parsed = json.loads(body.decode("utf-8"))
        except Exception as exc:
            sample = body[:500].decode("utf-8", errors="replace")
            raise TransferError(f"Expected JSON from {urllib.parse.urlsplit(url).netloc}, got: {sample}") from exc
        if not isinstance(parsed, dict):
            raise TransferError(f"Expected JSON object from {urllib.parse.urlsplit(url).netloc}.")
        return parsed


class RealDebridClient:
    def __init__(self, token: str, http: HttpClient | None = None):
        token = token.strip()
        if not token:
            raise TransferError("Real-Debrid API token is required.")
        self.http = http or HttpClient()
        self.headers = {"Authorization": f"Bearer {token}"}

    def user(self) -> dict[str, Any]:
        return self.http.json("GET", f"{REAL_DEBRID_API}/user", headers=self.headers)

    def add_source(self, source: str) -> str:
        source = source.strip().strip('"')
        if is_magnet(source):
            result = self.http.json(
                "POST",
                f"{REAL_DEBRID_API}/torrents/addMagnet",
                headers=self.headers,
                form={"magnet": source},
            )
        else:
            path = Path(source).expanduser()
            if not path.is_file():
                raise TransferError("Paste a magnet link or choose an existing .torrent file.")
            if path.suffix.lower() != ".torrent":
                raise TransferError("Selected local file must have a .torrent extension.")
            headers = dict(self.headers)
            headers["Content-Type"] = "application/x-bittorrent"
            result = self.http.json(
                "PUT",
                f"{REAL_DEBRID_API}/torrents/addTorrent",
                headers=headers,
                body=path.read_bytes(),
            )
        torrent_id = str(result.get("id") or "").strip()
        if not torrent_id:
            raise TransferError(f"Real-Debrid did not return a torrent id: {result}")
        return torrent_id

    def info(self, torrent_id: str) -> dict[str, Any]:
        return self.http.json(
            "GET",
            f"{REAL_DEBRID_API}/torrents/info/{urllib.parse.quote(torrent_id)}",
            headers=self.headers,
        )

    def select_files(self, torrent_id: str, file_ids: list[int]) -> None:
        self.http.request(
            "POST",
            f"{REAL_DEBRID_API}/torrents/selectFiles/{urllib.parse.quote(torrent_id)}",
            headers=self.headers,
            form={"files": ",".join(str(x) for x in file_ids)},
        )

    def unrestrict(self, link: str) -> RemoteFile:
        result = self.http.json(
            "POST",
            f"{REAL_DEBRID_API}/unrestrict/link",
            headers=self.headers,
            form={"link": link, "remote": 1},
        )
        download = str(result.get("download") or "").strip()
        if not download:
            raise TransferError(f"Real-Debrid did not return a remote download URL: {result}")
        return RemoteFile(
            filename=str(result.get("filename") or "download.bin"),
            size=int(result["filesize"]) if result.get("filesize") is not None else None,
            url=download,
        )

    def prepare_remote_files(
        self,
        source: str,
        *,
        selection_mode: str = "largest",
        callback: StatusCallback | None = None,
        cancel_event: Event | None = None,
        poll_seconds: float = 3.0,
        max_wait_seconds: int = 6 * 60 * 60,
    ) -> tuple[str, list[RemoteFile]]:
        _check_cancel(cancel_event)
        _emit(callback, "auth", "Checking Real-Debrid account...")
        user = self.user()
        account_type = str(user.get("type") or "unknown")
        if account_type != "premium":
            raise TransferError("Real-Debrid torrent endpoints require a Premium account.")
        _emit(callback, "torrent_add", f"Adding torrent to Real-Debrid ({account_type})...")
        torrent_id = self.add_source(source)

        deadline = time.monotonic() + max_wait_seconds
        last_status = None
        while time.monotonic() < deadline:
            _check_cancel(cancel_event)
            info = self.info(torrent_id)
            status = str(info.get("status") or "unknown")
            progress = int(info.get("progress") or 0)
            if status != last_status:
                _emit(callback, "torrent", f"Torrent status: {status}", progress=progress, torrent_id=torrent_id)
                last_status = status
            else:
                _emit(callback, "torrent", f"Torrent: {status} ({progress}%)", progress=progress, torrent_id=torrent_id)

            if status == "waiting_files_selection":
                ids = select_file_ids(info.get("files") or [], selection_mode)
                chosen = [f for f in (info.get("files") or []) if f.get("id") in ids]
                description = ", ".join(
                    f"{Path(str(f.get('path') or '')).name} ({human_bytes(f.get('bytes'))})" for f in chosen
                )
                _emit(callback, "select_files", f"Selecting {description or str(ids)}")
                self.select_files(torrent_id, ids)
                time.sleep(min(poll_seconds, 1.0))
                continue

            if status == "downloaded":
                links = info.get("links") or []
                if not links:
                    raise TransferError("Torrent completed but Real-Debrid returned no host links.")
                _emit(callback, "unrestrict", f"Torrent ready. Preparing {len(links)} server-to-server URL(s)...", progress=100)
                remote_files = []
                for index, link in enumerate(links, 1):
                    _check_cancel(cancel_event)
                    _emit(callback, "unrestrict", f"Preparing remote URL {index}/{len(links)}...", progress=100)
                    remote_files.append(self.unrestrict(str(link)))
                return torrent_id, remote_files

            if status in {"magnet_error", "error", "virus", "dead"}:
                raise TransferError(f"Real-Debrid torrent failed with status: {status}")
            time.sleep(poll_seconds)

        raise TransferError("Timed out waiting for the torrent to complete on Real-Debrid.")


class VikingFileHost:
    name = "ViKiNG FiLE"

    def __init__(self, user_hash: str = "", http: HttpClient | None = None):
        self.user_hash = user_hash.strip()
        self.http = http or HttpClient()

    def remote_upload(
        self,
        remote: RemoteFile,
        *,
        callback: StatusCallback | None = None,
        cancel_event: Event | None = None,
    ) -> HostedFile:
        _check_cancel(cancel_event)
        _emit(callback, "destination", f"ViKiNG is fetching {remote.filename} directly from Real-Debrid...")
        server_data = self.http.json("GET", f"{VIKING_API}/get-server")
        server = str(server_data.get("server") or "").strip()
        if not server.startswith("http"):
            raise TransferError(f"ViKiNG did not return a valid upload server: {server_data}")
        result = self.http.json(
            "POST",
            server,
            form={"link": remote.url, "user": self.user_hash, "name": remote.filename},
            timeout=60 * 60,
        )
        url = str(result.get("url") or "").strip()
        if not url:
            raise TransferError(f"ViKiNG remote upload did not return a final URL: {result}")
        _emit(callback, "verify", f"ViKiNG returned final link: {url}")
        file_hash = str(result.get("hash") or "").strip()
        if file_hash:
            check = self.http.json("POST", f"{VIKING_API}/check-file", form={"hash": file_hash})
            exists = check.get("exist")
            if exists is False:
                raise TransferError("ViKiNG returned a URL but its verification endpoint says the file does not exist.")
        return HostedFile(filename=str(result.get("name") or remote.filename), url=url, provider=self.name)


class FileQHost:
    name = "FileQ"

    def __init__(self, api_key: str, http: HttpClient | None = None):
        self.api_key = api_key.strip()
        if not self.api_key:
            raise TransferError("FileQ API key is required.")
        self.http = http or HttpClient()

    @staticmethod
    def _extract_file_code(data: dict[str, Any]) -> str:
        candidates: list[Any] = [data.get("file_code"), data.get("filecode")]
        result = data.get("result")
        if isinstance(result, dict):
            candidates.extend([result.get("file_code"), result.get("filecode"), result.get("code")])
        for candidate in candidates:
            value = str(candidate or "").strip()
            if value:
                return value
        return ""

    def remote_upload(
        self,
        remote: RemoteFile,
        *,
        callback: StatusCallback | None = None,
        cancel_event: Event | None = None,
        max_wait_seconds: int = 60 * 60,
    ) -> HostedFile:
        _check_cancel(cancel_event)
        _emit(callback, "destination", f"FileQ is fetching {remote.filename} directly from Real-Debrid...")
        query = urllib.parse.urlencode({"key": self.api_key, "url": remote.url, "folder": 0})
        initial = self.http.json("GET", f"{FILEQ_API}/upload/url?{query}", timeout=90)
        if int(initial.get("status") or 0) != 200:
            raise TransferError(f"FileQ rejected remote upload: {initial}")
        code = self._extract_file_code(initial)
        if not code:
            raise TransferError(
                "FileQ accepted the remote upload but did not return a file_code. "
                "Its public API documentation shows this ambiguity, so the prototype refuses to guess which account file is the new upload."
            )

        deadline = time.monotonic() + max_wait_seconds
        while time.monotonic() < deadline:
            _check_cancel(cancel_event)
            status_q = urllib.parse.urlencode({"key": self.api_key, "file_code": code})
            state = self.http.json("GET", f"{FILEQ_API}/upload/url?{status_q}", timeout=90)
            state_code = self._extract_file_code(state) or code
            state_message = str(state.get("msg") or "").strip().upper()
            if int(state.get("status") or 0) == 200 and state_code and state_message != "WORKING":
                url = f"https://fileq.net/{state_code}"
                _emit(callback, "verify", f"FileQ returned final link: {url}")
                return HostedFile(filename=remote.filename, url=url, provider=self.name)
            _emit(callback, "destination", "Waiting for FileQ remote upload...")
            time.sleep(3)
        raise TransferError("Timed out waiting for FileQ remote upload.")


class TransferOrchestrator:
    def __init__(
        self,
        real_debrid_token: str,
        destination: str,
        *,
        viking_user_hash: str = "",
        fileq_api_key: str = "",
        http: HttpClient | None = None,
    ):
        self.http = http or HttpClient()
        self.rd = RealDebridClient(real_debrid_token, self.http)
        normalized = destination.strip().lower()
        if normalized in {"viking", "viking file", "vikingfile", "viking file (anonymous)", "viking file / anonymous"}:
            self.destination = VikingFileHost(viking_user_hash, self.http)
        elif normalized in {"fileq", "file q"}:
            self.destination = FileQHost(fileq_api_key, self.http)
        else:
            raise TransferError(f"Unsupported destination: {destination}")

    def run(
        self,
        source: str,
        *,
        selection_mode: str = "largest",
        callback: StatusCallback | None = None,
        cancel_event: Event | None = None,
    ) -> dict[str, Any]:
        torrent_id, remote_files = self.rd.prepare_remote_files(
            source,
            selection_mode=selection_mode,
            callback=callback,
            cancel_event=cancel_event,
        )
        hosted: list[HostedFile] = []
        for index, remote in enumerate(remote_files, 1):
            _check_cancel(cancel_event)
            _emit(
                callback,
                "destination",
                f"Uploading destination file {index}/{len(remote_files)}: {remote.filename} ({human_bytes(remote.size)})",
                progress=100,
            )
            hosted.append(
                self.destination.remote_upload(
                    remote,
                    callback=callback,
                    cancel_event=cancel_event,
                )
            )
        _emit(callback, "complete", f"Transfer complete: {len(hosted)} file(s).", progress=100)
        return {
            "torrent_id": torrent_id,
            "destination": self.destination.name,
            "files": [
                {"filename": item.filename, "url": item.url, "provider": item.provider}
                for item in hosted
            ],
        }


def default_real_debrid_token() -> str:
    return os.environ.get("REAL_DEBRID_TOKEN", "")


def default_fileq_api_key() -> str:
    return os.environ.get("FILEQ_API_KEY", "")


def default_viking_user_hash() -> str:
    return os.environ.get("VIKING_USER_HASH", "")
