"""Server-side TorBox -> ViKiNG remote transfer; source URLs never reach disk or logs."""
from __future__ import annotations

import asyncio
import base64
import json
import binascii
import hashlib
import ipaddress
import logging
import os
import re
import socket
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, parse_qsl, urlencode, urlsplit, urlunsplit

from dotenv import load_dotenv
import httpx

from .request_diagnostics import detail
from .torbox_status_board import TorboxStatusBoard

logger = logging.getLogger("gameaccess.viking_cache")

_API_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_API_ROOT / ".env", override=False)

TORBOX_BASE = "https://api.torbox.app/v1/api"
VIKING_API_BASE = "https://vikingfile.com/api"
VIKING_FILE_BASE = "https://vikingfile.com/f/"

_TRANSIENT_QUERY_KEYS = re.compile(
    r"^(?:token|access_token|signature|sig|expires|expiry|authorization|auth|policy|jwt|"
    r"download_token|x-amz-.+|x-goog-.+|x-ms-.+|se|sp|sv|sr|st|skoid|sktid|skt|ske|sks|skv)$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class SourceIdentity:
    kind: str
    fingerprint: str
    host: str


@dataclass(frozen=True)
class VikingFileResult:
    name: str
    size_bytes: int
    file_hash: str
    url: str
    torbox_item_id: int


@dataclass(frozen=True)
class TorboxItem:
    """A source that TorBox has finished downloading, with what is needed to ask for its links."""

    item_id: int
    data: dict[str, Any]
    download_path: str
    id_param: str
    zip_link: bool


class ProviderFailure(Exception):
    """A safe, user-facing provider failure without upstream URLs or credentials."""

    def __init__(self, code: str, status_code: int, public_message: str):
        super().__init__(code)
        self.code = code
        self.status_code = status_code
        self.public_message = public_message


def normalize_source_url(source_url: str) -> SourceIdentity:
    """Validate a source and derive a stable fingerprint without retaining its URL."""
    value = str(source_url or "").strip()
    if not value or len(value) > 8192:
        raise ValueError("La URL de origen está vacía o es demasiado larga.")

    if value.lower().startswith("magnet:"):
        if not value.lower().startswith("magnet:?"):
            raise ValueError("El enlace magnet no tiene un formato válido.")
        query = parse_qs(urlsplit(value).query)
        exact_topics = [
            topic.strip().lower()
            for topic in query.get("xt", [])
            if topic.strip().lower().startswith(("urn:btih:", "urn:btmh:"))
        ]
        if not exact_topics:
            raise ValueError("El magnet no contiene un identificador de torrent válido.")
        # Trackers and display names can change without changing the torrent payload.
        identity = "torrent:" + "|".join(sorted(set(exact_topics)))
        return SourceIdentity(
            kind="torrent",
            fingerprint=hashlib.sha256(identity.encode("utf-8")).hexdigest(),
            host="magnet",
        )

    try:
        parsed = urlsplit(value)
        scheme = parsed.scheme.lower()
        host = (parsed.hostname or "").encode("idna").decode("ascii").lower()
        port = parsed.port
    except (ValueError, UnicodeError) as exc:
        raise ValueError("La URL de origen no es válida.") from exc

    if scheme not in ("http", "https") or not host or parsed.username or parsed.password:
        raise ValueError("La fuente debe ser un enlace HTTP(S) directo o un magnet.")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("No se permiten fuentes locales o privadas.")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise ValueError("No se permiten fuentes con direcciones IP privadas o reservadas.")
    if parsed.path.lower().endswith(".torrent"):
        raise ValueError("Para torrents, envía el enlace magnet; los archivos .torrent remotos aún no están admitidos.")

    default_port = (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    host_for_url = f"[{host}]" if ":" in host else host
    netloc = host_for_url if not port or default_port else f"{host_for_url}:{port}"
    stable_query = sorted(
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not _TRANSIENT_QUERY_KEYS.match(key)
    )
    canonical = urlunsplit((scheme, netloc, parsed.path or "/", urlencode(stable_query), ""))
    fingerprint = hashlib.sha256(("direct:" + canonical).encode("utf-8")).hexdigest()
    return SourceIdentity(kind="direct", fingerprint=fingerprint, host=host)


def _data_object(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data", payload)
    if isinstance(data, list):
        return next((item for item in data if isinstance(item, dict)), {})
    return data if isinstance(data, dict) else {}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError, OverflowError):
        return default


def _progress_fraction(item: dict[str, Any]) -> float:
    try:
        progress = float(item.get("progress") or 0)
    except (TypeError, ValueError):
        return 0.0
    return progress / 100.0 if progress > 1 else progress


def _is_finished(item: dict[str, Any]) -> bool:
    if item.get("download_finished") is True:
        return True
    state = str(item.get("download_state") or item.get("status") or "").strip().lower()
    if state not in {"completed", "complete", "finished"}:
        return False
    try:
        progress = float(item.get("progress") or 0)
    except (TypeError, ValueError):
        return False
    if progress > 1:
        progress /= 100.0
    size = _safe_int(item.get("size") or item.get("total_size"))
    return progress >= 1.0 and (size > 0 or bool(item.get("files")))


def _validate_viking_file_url(value: str, file_hash: str) -> str:
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
    except ValueError:
        host = ""
    if parsed.scheme == "https" and host in {"vikingfile.com", "www.vikingfile.com"} and file_hash:
        return value
    return VIKING_FILE_BASE + file_hash


PROBE_BYTES = 4 * 1024 * 1024
PROBE_MAX_SECONDS = 5.0
PROBE_MIN_BYTES = 512 * 1024
PROBE_MAX_REDIRECTS = 3
# TorBox sometimes answers 500 when it builds a zip right after a torrent finishes; a short retry usually works.
TORBOX_LINK_ATTEMPTS = 3
TORBOX_LINK_RETRY_SECONDS = 4.0


@dataclass(frozen=True)
class DeliveryDecision:
    """Whether the client should download the original link itself instead of using TorBox."""

    use_direct: bool
    reason: str
    speed_bps: int = 0


def magnet_infohash(source_url: str) -> str | None:
    """The torrent info hash of a magnet as 40 lowercase hex characters, if it has one."""
    if not str(source_url).lower().startswith("magnet:?"):
        return None
    for topic in parse_qs(urlsplit(source_url).query).get("xt", []):
        topic = topic.strip()
        if not topic.lower().startswith("urn:btih:"):
            continue
        value = topic[9:].strip()
        if re.fullmatch(r"[0-9a-fA-F]{40}", value):
            return value.lower()
        if re.fullmatch(r"[A-Za-z2-7]{32}", value):
            try:
                return binascii.hexlify(base64.b32decode(value.upper())).decode("ascii")
            except (binascii.Error, ValueError):
                return None
    return None


class WebPageLink(Exception):
    """The link opens a web page, not a file, so a person has to take the next step."""


async def _assert_public_host(host: str) -> None:
    """Refuse hosts whose DNS answers point at private or reserved addresses."""
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("No se pudo resolver el servidor de origen.") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if not address.is_global:
            raise ValueError("El origen apunta a una dirección privada o reservada.")


def parse_viking_upload_response(response: httpx.Response) -> dict[str, Any]:
    """ViKiNG answers a remote upload with a stream of JSON lines.

    Progress lines ({"progress":"41.2%",...}) come first and the last line is the result
    ({"name","size","hash"}) or an error, so the body is not one JSON document."""
    if response.status_code >= 400:
        raise ProviderFailure("viking_upload_failed", 502, "ViKiNG no pudo importar el archivo de TorBox.")
    objects: list[dict[str, Any]] = []
    for line in response.text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            objects.append(value)
    for value in reversed(objects):
        if value.get("hash"):
            return value
    for value in reversed(objects):
        error = value.get("error") or value.get("message")
        if error:
            logger.warning("viking_upload_rejected reason=%s", str(error)[:200])
            raise ProviderFailure("viking_upload_failed", 502, "ViKiNG rechazó la carga: " + str(error)[:160])
    logger.warning("viking_upload_unreadable status=%s body=%s", response.status_code, response.text[:300])
    if "can not download link" in response.text.lower():
        raise ProviderFailure("viking_cannot_fetch_link", 502, "ViKiNG no pudo descargar el enlace que le dio TorBox.")
    raise ProviderFailure("viking_upload_failed", 502, "ViKiNG no pudo importar el archivo de TorBox.")


def is_viking_upload_server(url: str) -> bool:
    """ViKiNG hands out regional upload servers (jp.vikingfile.com, upload.vikingfile.com, ...).

    Any HTTPS host under vikingfile.com is theirs; anything else is refused so the
    server never posts a TorBox link to a third party."""
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (host == "vikingfile.com" or host.endswith(".vikingfile.com"))


_BOARDS: dict[tuple[str, Any], TorboxStatusBoard] = {}


def _shared_board(provider: "TorBoxVikingProvider", interval: float) -> TorboxStatusBoard:
    """One board per TorBox account (and per fake transport in tests), shared by every provider instance."""
    key = (provider.torbox_api_key, provider.transport)
    board = _BOARDS.get(key)
    if board is None:
        board = _BOARDS[key] = TorboxStatusBoard(provider._list_torbox_items, interval=interval)
    return board


def torbox_summary() -> dict[str, Any]:
    """What TorBox is doing overall, from the shared list (no extra request to TorBox)."""
    board = _BOARDS.get((os.getenv("TORBOX_API_KEY", "").strip(), None))
    return board.summary() if board is not None else {"downloading": 0, "queued": 0, "stalled": 0, "ready": 0, "age_seconds": None}


class TorBoxVikingProvider:
    """Provider adapter. TorBox credentials are only sent to TorBox, never ViKiNG."""

    def __init__(
        self,
        *,
        torbox_api_key: str | None = None,
        viking_user_hash: str | None = None,
        viking_cookie: str | None = None,
        viking_rememberme: str | None = None,
        poll_interval_seconds: float | None = None,
        max_wait_seconds: int | None = None,
        upload_timeout_seconds: int | None = None,
        direct_min_mbps: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep_fn: Callable[[float], Any] = asyncio.sleep,
        stall_seconds: int | None = None,
        status_board: TorboxStatusBoard | None = None,
    ):
        self.torbox_api_key = (torbox_api_key if torbox_api_key is not None else os.getenv("TORBOX_API_KEY", "")).strip()
        self.viking_user_hash = (viking_user_hash if viking_user_hash is not None else os.getenv("VIKING_USER_HASH", "")).strip()
        self.viking_cookie = (viking_cookie if viking_cookie is not None else os.getenv("VIKING_COOKIE", "")).strip()
        self.viking_rememberme = (viking_rememberme if viking_rememberme is not None else os.getenv("VIKING_REMEMBERME", "")).strip()
        self.poll_interval_seconds = max(
            0.0,
            float(poll_interval_seconds if poll_interval_seconds is not None else os.getenv("GAMEACCESS_TORBOX_POLL_INTERVAL_SECONDS", "5")),
        )
        self.max_wait_seconds = max(
            1,
            int(max_wait_seconds if max_wait_seconds is not None else os.getenv("GAMEACCESS_TORBOX_MAX_WAIT_SECONDS", "10800")),
        )
        self.upload_timeout_seconds = max(
            1,
            int(upload_timeout_seconds if upload_timeout_seconds is not None else os.getenv("GAMEACCESS_VIKING_UPLOAD_TIMEOUT_SECONDS", "2400")),
        )
        # Megabits per second the server must measure before it hands the original link back.
        self.direct_min_bytes_per_second = int(
            max(0.0, float(direct_min_mbps if direct_min_mbps is not None else os.getenv("GAMEACCESS_DIRECT_MIN_MBPS", "20"))) * 125_000
        )
        self.transport = transport
        self.sleep_fn = sleep_fn
        # A source is given up on when TorBox shows no progress for this long (not after a fixed wait).
        self.stall_seconds = max(1, int(stall_seconds if stall_seconds is not None else os.getenv("GAMEACCESS_TORBOX_STALL_SECONDS", "900")))
        board_interval = poll_interval_seconds if poll_interval_seconds is not None else float(os.getenv("GAMEACCESS_TORBOX_BOARD_SECONDS", "8"))
        self.status_board = status_board or _shared_board(self, board_interval)

    async def _list_torbox_items(self, kind: str) -> list[dict[str, Any]]:
        """TorBox's whole download list for one kind: the data behind its dashboard, asked for once per refresh."""
        path = "/torrents/mylist" if kind == "torrent" else "/webdl/mylist"
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=15.0), transport=self.transport, follow_redirects=False) as client:
            payload = await self._torbox_json(client, "GET", path, params={"bypass_cache": "true"}, timeout=25.0)
        data = payload.get("data", [])
        if isinstance(data, dict):
            data = [data]
        return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []

    @staticmethod
    def _parse_json(response: httpx.Response, code: str, message: str) -> dict[str, Any]:
        if response.status_code >= 400:
            raise ProviderFailure(code, 502, message)
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderFailure(code, 502, message) from exc
        if not isinstance(payload, dict):
            raise ProviderFailure(code, 502, message)
        return payload

    async def _torbox_json(
        self,
        client: httpx.AsyncClient,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        timeout: float = 25.0,
    ) -> dict[str, Any]:
        if not self.torbox_api_key:
            raise ProviderFailure(
                "torbox_not_configured", 503,
                "El servicio de TorBox todavía no está configurado en el servidor.",
            )
        try:
            response = await client.request(
                method,
                TORBOX_BASE + path,
                params=params,
                data=data,
                headers={"Authorization": f"Bearer {self.torbox_api_key}", "User-Agent": "GameAccess/1.0"},
                timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            raise ProviderFailure("torbox_timeout", 504, "TorBox tardó demasiado en responder.") from exc
        except httpx.HTTPError as exc:
            raise ProviderFailure("torbox_unavailable", 502, "No se pudo conectar con TorBox.") from exc
        if response.status_code >= 500:
            raise ProviderFailure("torbox_server_error", 502, "TorBox tuvo un problema interno al preparar el archivo.")
        payload = self._parse_json(response, "torbox_api_error", "TorBox rechazó la solicitud.")
        if payload.get("success") is False:
            raise ProviderFailure("torbox_rejected", 502, "TorBox no pudo procesar esta fuente.")
        return payload

    async def check_viking_file(self, file_hash: str) -> bool:
        """Verify the stored ViKiNG file ID before reusing a cached URL."""
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=10.0),
            transport=self.transport,
            follow_redirects=False,
        ) as client:
            try:
                response = await client.post(
                    VIKING_API_BASE + "/check-file",
                    data={"hash": file_hash},
                )
            except httpx.TimeoutException as exc:
                raise ProviderFailure("viking_check_timeout", 502, "ViKiNG no respondió al comprobar el archivo.") from exc
            except httpx.HTTPError as exc:
                raise ProviderFailure("viking_check_failed", 502, "No se pudo comprobar el archivo en ViKiNG.") from exc
            if response.status_code >= 400:
                raise ProviderFailure("viking_check_failed", 502, "No se pudo comprobar el archivo en ViKiNG.")
            try:
                payload = response.json()
            except ValueError as exc:
                raise ProviderFailure("viking_check_failed", 502, "No se pudo comprobar el archivo en ViKiNG.") from exc
        # ViKiNG answers with one object for old clients and a list when the hash is sent as a batch.
        if isinstance(payload, list):
            payload = next(
                (item for item in payload if isinstance(item, dict) and item.get("hash") == file_hash),
                next((item for item in payload if isinstance(item, dict)), {}),
            )
        if not isinstance(payload, dict):
            raise ProviderFailure("viking_check_invalid", 502, "ViKiNG devolvió una respuesta de verificación inválida.")
        exists = payload.get("exist")
        if not isinstance(exists, bool):
            raise ProviderFailure("viking_check_invalid", 502, "ViKiNG devolvió una respuesta de verificación inválida.")
        return exists

    def _viking_cookie_header(self) -> str:
        parts: list[str] = []
        if self.viking_rememberme:
            val = self.viking_rememberme
            if "REMEMBERME=" not in val:
                val = f"REMEMBERME={val}"
            parts.append(val)
        if self.viking_cookie:
            val = self.viking_cookie
            if "PHPSESSID=" not in val and "REMEMBERME=" not in val:
                val = f"PHPSESSID={val}"
            if val not in parts:
                parts.append(val)
        return "; ".join(parts)

    async def resolve_viking_direct_link(self, file_url_or_hash: str) -> str:
        """Resolve a ViKiNG file landing page or hash (e.g. /f/<hash>) to the signed direct CDN download URL."""
        cookie_header = self._viking_cookie_header()
        value = str(file_url_or_hash or "").strip()
        if not value:
            raise ProviderFailure("viking_invalid_url", 502, "La URL o identificador de ViKiNG está vacío.")

        file_url = value if value.startswith(("http://", "https://")) else VIKING_FILE_BASE + value
        if not cookie_header:
            logger.warning("viking_direct_resolve_skipped reason=no_cookie_configured")
            return file_url

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Cookie": cookie_header,
        }

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(25.0, connect=10.0),
            transport=self.transport,
            follow_redirects=False,
        ) as client:
            try:
                r1 = await client.get(file_url, headers=headers)
            except httpx.TimeoutException as exc:
                raise ProviderFailure("viking_resolve_timeout", 504, "ViKiNG tardó demasiado en responder al resolver la descarga.") from exc
            except httpx.HTTPError as exc:
                raise ProviderFailure("viking_resolve_failed", 502, "No se pudo conectar con ViKiNG para resolver la descarga.") from exc

            if r1.status_code not in (301, 302, 303, 307, 308):
                if "challenges.cloudflare.com" in r1.text or 'id="captcha"' in r1.text:
                    raise ProviderFailure(
                        "viking_auth_required",
                        502,
                        "ViKiNG requiere verificación de captcha; la sesión configurada puede estar expirada.",
                    )
                raise ProviderFailure("viking_resolve_failed", 502, "ViKiNG no redirigió a la descarga directa.")

            location1 = r1.headers.get("location", "")
            if not location1:
                raise ProviderFailure("viking_resolve_failed", 502, "ViKiNG no devolvió la dirección de redirección intermedia.")

            step2_url = str(httpx.URL(file_url).join(location1))

            new_cookies = {}
            for sc in r1.headers.get_list("set-cookie"):
                parts = sc.split(";")[0].split("=", 1)
                if len(parts) == 2:
                    new_cookies[parts[0].strip()] = parts[1].strip()

            merged = [cookie_header]
            for k, v in new_cookies.items():
                if f"{k}=" not in cookie_header:
                    merged.append(f"{k}={v}")
            headers["Cookie"] = "; ".join(merged)

            try:
                r2 = await client.get(step2_url, headers=headers)
            except httpx.TimeoutException as exc:
                raise ProviderFailure("viking_resolve_timeout", 504, "ViKiNG tardó demasiado en generar el enlace directo.") from exc
            except httpx.HTTPError as exc:
                raise ProviderFailure("viking_resolve_failed", 502, "No se pudo conectar con ViKiNG para generar el enlace directo.") from exc

            if r2.status_code in (301, 302, 303, 307, 308):
                location2 = r2.headers.get("location", "")
                if location2:
                    return str(httpx.URL(step2_url).join(location2))

            if r2.status_code == 200:
                content_type = r2.headers.get("content-type", "").lower()
                if "application/" in content_type or "octet-stream" in content_type:
                    return step2_url

            raise ProviderFailure("viking_resolve_failed", 502, "No se pudo obtener el enlace directo al archivo en ViKiNG.")

    @staticmethod
    def torbox_files(item: "TorboxItem") -> list[dict[str, Any]]:
        """The files of a finished TorBox item as {"id", "name", "size"}, in TorBox order."""
        if item.id_param == "torrent_id":
            raw = item.data.get("files")
            files = [
                {
                    "id": entry.get("id"),
                    "name": str(entry.get("short_name") or entry.get("name") or "").strip() or f"file-{entry.get('id')}",
                    "size": _safe_int(entry.get("size")),
                }
                for entry in (raw if isinstance(raw, list) else [])
                if isinstance(entry, dict) and _safe_int(entry.get("size")) > 0
            ]
            files.sort(key=lambda entry: (_safe_int(entry["id"]), entry["name"]))
        else:
            size = _safe_int(item.data.get("size") or item.data.get("total_size"))
            name = str(item.data.get("name") or "download").strip()
            files = [{"id": None, "name": name, "size": size}] if size > 0 else []
        if not files:
            raise ProviderFailure("torbox_no_files", 502, "TorBox no informó los archivos de esta fuente.")
        return files

    async def prepare_chunk_source(
        self,
        client: httpx.AsyncClient,
        *,
        source_url: str,
        source_kind: str,
        source_host: str,
        file_name: str,
        request_id: str,
        installation_id: str,
        fingerprint: str,
        on_status: Any = None,
    ) -> tuple["TorboxItem", list[dict[str, Any]]]:
        """Submit a source to TorBox, wait for it, and return it with its file list."""
        if not self.torbox_api_key:
            raise ProviderFailure(
                "torbox_not_configured", 503,
                "El servicio de TorBox todavía no está configurado en el servidor.",
            )
        item = await self._torbox_submit_and_wait(
            client,
            source_url=source_url,
            source_kind=source_kind,
            source_host=source_host,
            file_name=file_name,
            request_id=request_id,
            installation_id=installation_id,
            fingerprint=fingerprint,
            on_status=on_status,
        )
        return item, self.torbox_files(item)

    async def torbox_file_link(self, client: httpx.AsyncClient, item: "TorboxItem", file_id: int | None) -> str:
        """A fresh temporary link to one file of a finished TorBox item (never a zip)."""
        params: dict[str, Any] = {
            "token": self.torbox_api_key,
            item.id_param: item.item_id,
            "zip_link": "false",
            "redirect": "false",
        }
        if file_id is not None:
            params["file_id"] = file_id
        payload = await self._torbox_link_with_retry(
            client, item.download_path, params, request_id="chunks", installation_id="server", item_id=item.item_id,
        )
        link = payload.get("data")
        if not isinstance(link, str) or urlsplit(link).scheme != "https":
            raise ProviderFailure("torbox_invalid_download_link", 502, "TorBox no devolvió un enlace temporal válido.")
        return link

    async def upload_file_to_viking(self, path: "Path", name: str, folder: str = "") -> dict[str, Any]:
        """Upload a local file to ViKiNG with a normal multipart upload and return its JSON result."""
        timeout = httpx.Timeout(
            float(self.upload_timeout_seconds), connect=20.0, read=float(self.upload_timeout_seconds),
            write=float(self.upload_timeout_seconds), pool=20.0,
        )
        async with httpx.AsyncClient(timeout=timeout, transport=self.transport, follow_redirects=False) as client:
            server_payload = await self._viking_json(client, "GET", VIKING_API_BASE + "/get-server", timeout=20.0)
            upload_server = str(server_payload.get("server") or "")
            if not is_viking_upload_server(upload_server):
                raise ProviderFailure("viking_invalid_upload_server", 502, "ViKiNG devolvió un servidor de carga inválido.")
            try:
                with path.open("rb") as handle:
                    response = await client.post(
                        upload_server,
                        data={"user": self.viking_user_hash, **({"path": folder} if folder else {})},
                        files={"file": (name, handle, "application/octet-stream")},
                    )
            except httpx.TimeoutException as exc:
                raise ProviderFailure("viking_upload_timeout", 504, "ViKiNG tardó demasiado en recibir el archivo.") from exc
            except httpx.HTTPError as exc:
                raise ProviderFailure("viking_upload_failed", 502, "No se pudo subir el archivo a ViKiNG.") from exc
        return parse_viking_upload_response(response)

    async def _torbox_submit_and_wait(
        self,
        client: httpx.AsyncClient,
        *,
        source_url: str,
        source_kind: str,
        source_host: str,
        file_name: str,
        request_id: str,
        installation_id: str,
        fingerprint: str,
        on_status: Any = None,
    ) -> "TorboxItem":
        """Submit a source to TorBox and wait until it has finished downloading there.

        `on_status(item)` (optional, async) is told what TorBox reports on every check."""
        if source_kind == "torrent":
            form: dict[str, Any] = {
                "magnet": source_url,
                "seed": 0,
                "allow_zip": "true",
            }
            if file_name:
                form["name"] = file_name
            logger.info(
                "request=%s client=%s stage=torbox_submit kind=torrent fingerprint=%s",
                request_id, installation_id, fingerprint[:12],
            )
            created = await self._torbox_json(client, "POST", "/torrents/createtorrent", data=form)
            created_data = _data_object(created)
            item_id = _safe_int(created_data.get("torrent_id") or created_data.get("id"))
            if not item_id:
                raise ProviderFailure("torbox_invalid_response", 502, "TorBox no devolvió el identificador del torrent.")
            item_path = "/torrents/mylist"
            download_path = "/torrents/requestdl"
            id_param = "torrent_id"
            zip_link = True
        else:
            form = {"link": source_url}
            if file_name:
                form["name"] = file_name
            logger.info(
                "request=%s client=%s stage=torbox_submit kind=direct host=%s fingerprint=%s",
                request_id, installation_id, source_host, fingerprint[:12],
            )
            created = await self._torbox_json(client, "POST", "/webdl/createwebdownload", data=form)
            created_data = _data_object(created)
            item_id = _safe_int(
                created_data.get("web_id")
                or created_data.get("webdl_id")
                or created_data.get("webdownload_id")
                or created_data.get("id")
            )
            if not item_id:
                raise ProviderFailure("torbox_invalid_response", 502, "TorBox no devolvió el identificador de la descarga.")
            item_path = "/webdl/mylist"
            download_path = "/webdl/requestdl"
            id_param = "web_id"
            zip_link = False

        logger.info(
            "request=%s client=%s stage=torbox_wait provider_id=%s kind=%s",
            request_id, installation_id, item_id, source_kind,
        )
        board_kind = "torrent" if source_kind == "torrent" else "web"
        started = time.monotonic()
        deadline = started + self.max_wait_seconds
        last_progress, last_move = -1.0, started
        completed_item: dict[str, Any] = {}
        while True:
            # The shared board answers for every waiting job (one TorBox request per interval in total).
            item = await self.status_board.get(board_kind, item_id)
            if item is None:  # TorBox's list does not show it (yet): ask for this one item
                status_payload = await self._torbox_json(
                    client,
                    "GET",
                    item_path,
                    params={"id": item_id, "bypass_cache": "true"},
                    timeout=25.0,
                )
                item = _data_object(status_payload)
            completed_item = item
            if on_status is not None:
                try:
                    await on_status(completed_item)
                except Exception:  # reporting must never stop the transfer
                    logger.debug("torbox on_status failed", exc_info=True)
            if _is_finished(completed_item):
                break
            state = str(completed_item.get("download_state") or completed_item.get("status") or "").lower()
            if state in {"error", "failed", "dead", "cancelled", "canceled"}:
                raise ProviderFailure("torbox_download_failed", 502, "TorBox no pudo completar la descarga de origen.")
            now = time.monotonic()
            progress = _progress_fraction(completed_item)
            if progress > last_progress or state == "queued":  # waiting in TorBox's own queue is not a stall
                last_progress, last_move = max(progress, last_progress), now
            if now - last_move >= self.stall_seconds:
                if _safe_int(completed_item.get("seeds")) == 0:
                    raise ProviderFailure("torbox_stalled", 502, "Nadie está compartiendo este torrent y TorBox no avanza. Probá con otra fuente.")
                raise ProviderFailure("torbox_stalled", 502, "TorBox dejó de avanzar con esta fuente. Probá más tarde o con otra fuente.")
            remaining = deadline - now
            if remaining <= 0:
                raise ProviderFailure("torbox_wait_timeout", 504, "La fuente todavía no está lista en TorBox; vuelve a intentarlo.")
            await self.sleep_fn(min(self.poll_interval_seconds, remaining) if self.poll_interval_seconds else 0)
        return TorboxItem(
            item_id=item_id,
            data=completed_item,
            download_path=download_path,
            id_param=id_param,
            zip_link=zip_link,
        )

    async def _torbox_link_with_retry(
        self,
        client: httpx.AsyncClient,
        download_path: str,
        params: dict[str, Any],
        *,
        request_id: str,
        installation_id: str,
        item_id: int,
    ) -> dict[str, Any]:
        for attempt in range(1, TORBOX_LINK_ATTEMPTS + 1):
            try:
                return await self._torbox_json(client, "GET", download_path, params=params, timeout=30.0)
            except ProviderFailure as exc:
                if exc.code != "torbox_server_error" or attempt == TORBOX_LINK_ATTEMPTS:
                    raise
                logger.warning(
                    "request=%s client=%s stage=torbox_link_retry attempt=%s provider_id=%s",
                    request_id, installation_id, attempt, item_id,
                )
                await self.sleep_fn(TORBOX_LINK_RETRY_SECONDS * attempt)
        raise ProviderFailure("torbox_server_error", 502, "TorBox tuvo un problema interno al preparar el archivo.")

    async def process_source(
        self,
        *,
        source_url: str,
        source_kind: str,
        source_host: str,
        item_name: str,
        file_name: str,
        request_id: str,
        installation_id: str,
        fingerprint: str,
    ) -> VikingFileResult:
        if not self.torbox_api_key:
            raise ProviderFailure(
                "torbox_not_configured", 503,
                "El servicio de TorBox todavía no está configurado en el servidor.",
            )

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=15.0),
            transport=self.transport,
            follow_redirects=False,
        ) as client:
            item = await self._torbox_submit_and_wait(
                client,
                source_url=source_url,
                source_kind=source_kind,
                source_host=source_host,
                file_name=file_name,
                request_id=request_id,
                installation_id=installation_id,
                fingerprint=fingerprint,
            )
            item_id, download_path, id_param, zip_link = item.item_id, item.download_path, item.id_param, item.zip_link

            params = {
                "token": self.torbox_api_key,
                id_param: item_id,
                "zip_link": "true" if zip_link else "false",
                "redirect": "false",
            }
            logger.info(
                "request=%s client=%s stage=torbox_link_ready provider_id=%s",
                request_id, installation_id, item_id,
            )
            link_payload = await self._torbox_link_with_retry(
                client, download_path, params,
                request_id=request_id, installation_id=installation_id, item_id=item_id,
            )
            temporary_link = link_payload.get("data")
            if not isinstance(temporary_link, str) or urlsplit(temporary_link).scheme != "https":
                raise ProviderFailure("torbox_invalid_download_link", 502, "TorBox no devolvió un enlace temporal válido.")

            server_payload = await self._viking_json(
                client, "GET", VIKING_API_BASE + "/get-server", timeout=20.0
            )
            upload_server = str(server_payload.get("server") or "")
            parsed_server = urlsplit(upload_server)
            if not is_viking_upload_server(upload_server):
                raise ProviderFailure("viking_invalid_upload_server", 502, "ViKiNG devolvió un servidor de carga inválido.")

            upload_data = {"link": temporary_link, "user": self.viking_user_hash}
            if file_name:
                upload_data["name"] = file_name
            logger.info(
                "request=%s client=%s stage=viking_remote_upload host=%s item=%s",
                request_id, installation_id, source_host, (item_name or "unknown")[:80],
            )
            upload_timeout = httpx.Timeout(
                float(self.upload_timeout_seconds),
                connect=20.0,
                read=float(self.upload_timeout_seconds),
                write=30.0,
                pool=20.0,
            )
            try:
                upload_response = await client.post(
                    upload_server,
                    data=upload_data,
                    timeout=upload_timeout,
                )
            except httpx.TimeoutException as exc:
                raise ProviderFailure("viking_upload_timeout", 504, "ViKiNG tardó demasiado en importar el archivo.") from exc
            except httpx.HTTPError as exc:
                raise ProviderFailure("viking_upload_failed", 502, "No se pudo completar la carga remota en ViKiNG.") from exc
            upload_payload = parse_viking_upload_response(upload_response)
            file_hash = str(upload_payload.get("hash") or "").strip()
            if not file_hash:
                raise ProviderFailure("viking_upload_invalid_response", 502, "ViKiNG no devolvió el identificador del archivo.")
            file_url = _validate_viking_file_url(str(upload_payload.get("url") or ""), file_hash)
            name = str(upload_payload.get("name") or file_name or item_name or "download").strip()[:300]
            size_bytes = _safe_int(upload_payload.get("size"))
            logger.info(
                "request=%s client=%s stage=viking_upload_complete provider_id=%s file_hash=%s size_bytes=%s",
                request_id, installation_id, item_id, file_hash, size_bytes,
            )
            return VikingFileResult(
                name=name,
                size_bytes=size_bytes,
                file_hash=file_hash,
                url=file_url,
                torbox_item_id=item_id,
            )

    async def torbox_has_cached(self, info_hash: str) -> bool:
        """True when TorBox already holds this torrent, so no download wait is needed."""
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(30.0, connect=15.0), transport=self.transport, follow_redirects=False
        ) as client:
            payload = await self._torbox_json(
                client, "GET", "/torrents/checkcached",
                params={"hash": info_hash, "format": "object", "list_files": "false"},
            )
        data = payload.get("data")
        return isinstance(data, dict) and info_hash.lower() in {str(key).lower() for key in data}

    async def probe_direct_speed(self, url: str) -> int | None:
        """Bytes per second measured by reading the first megabytes of a direct link.

        Redirects are followed by hand so every hop is checked to be a public host.
        Returns None when the link cannot be measured.
        """
        current = url
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=8.0), transport=self.transport, follow_redirects=False
        ) as client:
            for _ in range(PROBE_MAX_REDIRECTS + 1):
                parsed = urlsplit(current)
                host = (parsed.hostname or "").lower()
                if parsed.scheme not in ("http", "https") or not host:
                    return None
                await _assert_public_host(host)
                async with client.stream(
                    "GET", current,
                    headers={"Range": f"bytes=0-{PROBE_BYTES - 1}", "User-Agent": "GameAccess/1.0"},
                ) as response:
                    if response.status_code in (301, 302, 303, 307, 308):
                        location = response.headers.get("location", "")
                        if not location:
                            return None
                        current = str(httpx.URL(current).join(location))
                        continue
                    if response.status_code not in (200, 206):
                        return None
                    if "text/html" in response.headers.get("content-type", "").lower():
                        raise WebPageLink()
                    received = 0
                    first_byte_at = None
                    async for chunk in response.aiter_bytes():
                        now = time.monotonic()
                        if first_byte_at is None:
                            first_byte_at = now
                        received += len(chunk)
                        if received >= PROBE_BYTES or now - first_byte_at >= PROBE_MAX_SECONDS:
                            break
                    if first_byte_at is None or received < PROBE_MIN_BYTES:
                        return None
                    elapsed = max(time.monotonic() - first_byte_at, 0.05)
                    return int(received / elapsed)
        return None

    async def decide_delivery(self, *, source_url: str, source_kind: str) -> DeliveryDecision:
        """Decide whether processing through TorBox is worth it. Never raises."""
        try:
            if source_kind == "torrent":
                info_hash = magnet_infohash(source_url)
                if info_hash and await self.torbox_has_cached(info_hash):
                    return DeliveryDecision(False, "cached_in_torbox")
                # Peer health is not measured yet, so an uncached torrent goes through TorBox.
                return DeliveryDecision(False, "torrent_needs_torbox")
            speed = await self.probe_direct_speed(source_url)
            if speed is not None and speed >= self.direct_min_bytes_per_second:
                return DeliveryDecision(True, "fast_direct", speed)
            return DeliveryDecision(False, "slow_or_unmeasurable", speed or 0)
        except WebPageLink:
            # Pages that need a person (captchas, countdowns) are outside this comparison.
            return DeliveryDecision(False, "web_page")
        except (ProviderFailure, ValueError, httpx.HTTPError):
            return DeliveryDecision(False, "analysis_failed")

    async def _viking_json(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        *,
        timeout: float,
    ) -> dict[str, Any]:
        try:
            response = await client.request(method, url, timeout=timeout)
        except httpx.TimeoutException as exc:
            raise ProviderFailure("viking_api_timeout", 502, "ViKiNG tardó demasiado en responder.") from exc
        except httpx.HTTPError as exc:
            raise ProviderFailure("viking_api_unavailable", 502, "No se pudo conectar con ViKiNG.") from exc
        return self._parse_json(response, "viking_api_error", "ViKiNG rechazó la solicitud.")


def create_provider() -> TorBoxVikingProvider:
    """Factory kept separate so route tests can inject a fake provider."""
    return TorBoxVikingProvider()
