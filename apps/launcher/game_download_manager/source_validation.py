"""Source identity and payload validation; no provider discovery or state."""
from __future__ import annotations
import re
from urllib.parse import urlparse, parse_qs
from html import unescape

def normalize_download_source(source):
    source = source.strip()
    if source.lower().startswith("magnet:"):
        source = unescape("magnet:" + source.split(":", 1)[1])
        topics = parse_qs(urlparse(source).query).get("xt", [])
        if not any(re.fullmatch(r"urn:btih:(?:[a-f0-9]{40}|[a-z2-7]{32})", topic, re.I)
                   or re.fullmatch(r"urn:btmh:1220[a-f0-9]{64}", topic, re.I) for topic in topics):
            raise ValueError("El magnet no contiene un identificador torrent válido.")
        return source
    parsed = urlparse(source)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise ValueError("La fuente debe ser un magnet válido o un enlace HTTP/HTTPS.")
    return parsed.scheme.lower() + source[len(parsed.scheme):]


def is_torrent_source(source):
    return source.lower().startswith("magnet:?") or urlparse(source).path.lower().endswith(".torrent")


def validate_http_file_response(response, inspect_body=False):
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").lower()
    if any(value in content_type for value in ("text/html", "application/xhtml", "application/json")):
        detail = ""
        if response.status_code >= 400:
            detail = response.text[:200]
        raise RuntimeError("La fuente devolvió una página web, no el archivo del juego. El plugin debe resolver el enlace." + detail)
    if inspect_body:
        # A small streaming probe catches landing pages mislabeled as binary.
        prefix = next(response.iter_content(chunk_size=512), b"").lstrip(b"\xef\xbb\xbf \r\n\t").lower()
        if prefix.startswith((b"<!doctype html", b"<html", b"<head", b"<body")):
            raise RuntimeError("La fuente devolvió contenido HTML, no el archivo del juego.")


def validate_downloaded_file(filepath):
    with open(filepath, "rb") as file:
        prefix = file.read(512).lstrip(b"\xef\xbb\xbf \r\n\t").lower()
    if not prefix or prefix.startswith((b"<!doctype html", b"<html", b"<head", b"<body")):
        raise RuntimeError("El archivo descargado está vacío o contiene una página web; se ha detenido la instalación.")
