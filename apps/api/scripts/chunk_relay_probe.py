#!/usr/bin/env python3
"""Prototype: TorBox (HTTP Range) -> small pieces -> ViKiNG, pipelined.

It answers four questions before anything is built into the server:
  1. Does TorBox honour Range on its download link (and on the zip link)?
  2. How fast does this machine pull a piece from TorBox and push it to ViKiNG?
  3. Does the free ViKiNG account hand back DIRECT links for the pieces?
  4. Do the pieces downloaded back from ViKiNG match what TorBox sent (sha256)?

Usage (from apps/api):
  python scripts/chunk_relay_probe.py --list
  python scripts/chunk_relay_probe.py --kind torrent --id 123            # largest file of the torrent
  python scripts/chunk_relay_probe.py --kind torrent --id 123 --file-id 4
  python scripts/chunk_relay_probe.py --kind torrent --id 123 --zip      # TorBox zip link
  python scripts/chunk_relay_probe.py --kind webdl --id 55 --chunk-mb 50 --chunks 4 --cleanup

Links and tokens are never printed; only host names.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import math
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

API_ROOT = Path(__file__).resolve().parent.parent
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.viking_cache_service import (  # noqa: E402
    TORBOX_BASE,
    VIKING_API_BASE,
    ProviderFailure,
    is_viking_upload_server,
    parse_viking_upload_response,
)

MB = 1024 * 1024


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    env_file = API_ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def say(message: str) -> None:
    print(message, flush=True)


def human(size: float) -> str:
    return f"{size / MB:,.1f} MB" if size < 1024 * MB else f"{size / (1024 * MB):,.2f} GB"


def speed(size: float, seconds: float) -> str:
    return f"{size * 8 / max(seconds, 0.001) / 1_000_000:,.0f} Mbps"


class Torbox:
    def __init__(self, token: str, client: httpx.AsyncClient):
        self.token = token
        self.client = client

    async def get(self, path: str, **params):
        response = await self.client.get(
            TORBOX_BASE + path,
            params=params or None,
            headers={"Authorization": f"Bearer {self.token}", "User-Agent": "GameAccess/1.0"},
            timeout=30.0,
        )
        response.raise_for_status()
        return response.json()

    async def mylist(self, kind: str):
        path = "/torrents/mylist" if kind == "torrent" else "/webdl/mylist"
        payload = await self.get(path)
        data = payload.get("data")
        return data if isinstance(data, list) else ([data] if data else [])

    async def link(self, kind: str, item_id: int, file_id: int | None, zip_link: bool) -> str:
        if kind == "torrent":
            params = {"token": self.token, "torrent_id": item_id, "zip_link": "true" if zip_link else "false", "redirect": "false"}
            if file_id is not None and not zip_link:
                params["file_id"] = file_id
            payload = await self.get("/torrents/requestdl", **params)
        else:
            params = {"token": self.token, "web_id": item_id, "zip_link": "false", "redirect": "false"}
            if file_id is not None:
                params["file_id"] = file_id
            payload = await self.get("/webdl/requestdl", **params)
        link = payload.get("data")
        if not isinstance(link, str) or not link.startswith("https://"):
            raise SystemExit("TorBox no devolvió un link válido.")
        return link


async def list_items(torbox: Torbox) -> None:
    for kind in ("torrent", "webdl"):
        try:
            items = await torbox.mylist(kind)
        except httpx.HTTPError as exc:
            say(f"[{kind}] no se pudo listar: {type(exc).__name__}")
            continue
        say(f"\n== {kind} ({len(items)}) ==")
        for item in items[:40]:
            files = item.get("files") or []
            say(
                f"id={item.get('id'):<8} {human(float(item.get('size') or 0)):>10}  "
                f"terminado={bool(item.get('download_finished'))!s:<5} archivos={len(files):<3} {str(item.get('name'))[:70]}"
            )


async def probe_range(client: httpx.AsyncClient, url: str) -> int | None:
    host = urlsplit(url).hostname
    say(f"\n[1] Probando Range en {host} ...")
    async with client.stream("GET", url, headers={"Range": "bytes=0-0"}, follow_redirects=True, timeout=30.0) as response:
        content_range = response.headers.get("content-range", "")
        say(
            f"    status={response.status_code} accept-ranges={response.headers.get('accept-ranges')} "
            f"content-range={content_range or '-'} content-length={response.headers.get('content-length')} "
            f"type={response.headers.get('content-type')}"
        )
        if response.status_code == 206 and "/" in content_range:
            total = content_range.rsplit("/", 1)[1]
            if total.isdigit():
                say(f"    RANGE OK, tamaño total {human(int(total))}")
                return int(total)
        say("    RANGE NO soportado (o sin tamaño total): no se puede partir en pedazos por este link.")
        return None


async def fetch_piece(client: httpx.AsyncClient, url: str, start: int, end: int) -> bytes:
    buffer = bytearray()
    async with client.stream(
        "GET", url, headers={"Range": f"bytes={start}-{end}"}, follow_redirects=True,
        timeout=httpx.Timeout(120.0, connect=20.0),
    ) as response:
        if response.status_code != 206:
            raise RuntimeError(f"TorBox respondió {response.status_code} al pedir el rango")
        async for chunk in response.aiter_bytes(1 << 20):
            buffer.extend(chunk)
    if len(buffer) != end - start + 1:
        raise RuntimeError(f"pedazo incompleto: {len(buffer)} de {end - start + 1}")
    return bytes(buffer)


async def upload_piece(client: httpx.AsyncClient, user: str, name: str, data: bytes) -> dict:
    server = (await client.get(VIKING_API_BASE + "/get-server", timeout=20.0)).json().get("server", "")
    if not is_viking_upload_server(server):
        raise RuntimeError("servidor de carga de ViKiNG inválido")
    response = await client.post(
        server,
        data={"user": user},
        files={"file": (name, data, "application/octet-stream")},
        timeout=httpx.Timeout(900.0, connect=20.0, write=600.0),
    )
    return parse_viking_upload_response(response)


async def check_viking_link(client: httpx.AsyncClient, url: str) -> str:
    """Return 'direct', 'page' or 'unknown' for a ViKiNG file URL."""
    async with client.stream(
        "GET", url, headers={"Range": "bytes=0-1023", "User-Agent": "GameAccess/1.0"},
        follow_redirects=True, timeout=30.0,
    ) as response:
        content_type = response.headers.get("content-type", "")
        final_host = response.url.host
        head = b""
        async for chunk in response.aiter_bytes(2048):
            head = chunk
            break
    kind = "page" if "text/html" in content_type.lower() else ("direct" if response.status_code in (200, 206) else "unknown")
    say(f"    {url}: status={response.status_code} type={content_type} final_host={final_host} -> {kind.upper()}")
    if kind == "page":
        text = head.decode("utf-8", "ignore").replace("\n", " ")[:160]
        say(f"      inicio de la página: {text}")
    return kind


async def download_hash(client: httpx.AsyncClient, url: str) -> tuple[str, int, float]:
    digest = hashlib.sha256()
    total = 0
    started = time.monotonic()
    async with client.stream("GET", url, follow_redirects=True, timeout=httpx.Timeout(300.0, connect=20.0)) as response:
        async for chunk in response.aiter_bytes(1 << 20):
            digest.update(chunk)
            total += len(chunk)
    return digest.hexdigest(), total, time.monotonic() - started


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true", help="listar ítems terminados en TorBox")
    parser.add_argument("--kind", choices=["torrent", "webdl"], default="torrent")
    parser.add_argument("--id", type=int, help="id del ítem en TorBox")
    parser.add_argument("--file-id", type=int, help="archivo concreto dentro del torrent")
    parser.add_argument("--zip", action="store_true", help="usar el link zip de TorBox")
    parser.add_argument("--chunk-mb", type=int, default=100)
    parser.add_argument("--chunks", type=int, default=3)
    parser.add_argument("--start-mb", type=int, default=0)
    parser.add_argument("--cleanup", action="store_true", help="borrar de ViKiNG los pedazos de prueba al terminar")
    args = parser.parse_args()

    env = load_env()
    token, user = env.get("TORBOX_API_KEY", ""), env.get("VIKING_USER_HASH", "")
    if not token:
        raise SystemExit("Falta TORBOX_API_KEY en apps/api/.env")

    async with httpx.AsyncClient() as client:
        torbox = Torbox(token, client)
        if args.list:
            await list_items(torbox)
            return
        if args.id is None:
            raise SystemExit("Indicá --id (usá --list para verlos).")
        if not user:
            say("Aviso: sin VIKING_USER_HASH, la subida será anónima.")

        file_id = args.file_id
        if args.kind == "torrent" and file_id is None and not args.zip:
            items = [i for i in await torbox.mylist("torrent") if i.get("id") == args.id]
            files = (items[0].get("files") if items else None) or []
            if files:
                biggest = max(files, key=lambda f: f.get("size") or 0)
                file_id = biggest.get("id")
                say(f"Archivo más grande del torrent: id={file_id} {human(float(biggest.get('size') or 0))} {str(biggest.get('name'))[-60:]}")

        link = await torbox.link(args.kind, args.id, file_id, args.zip)
        total = await probe_range(client, link)
        if total is None:
            return

        piece = args.chunk_mb * MB
        start0 = args.start_mb * MB
        count = max(1, min(args.chunks, math.ceil((total - start0) / piece)))
        say(f"\n[2] Pipeline: {count} pedazos de {args.chunk_mb} MB (bajar el siguiente mientras sube el anterior)")

        queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        records: list[dict] = []
        t0 = time.monotonic()

        async def producer() -> None:
            for index in range(count):
                start = start0 + index * piece
                end = min(start + piece, total) - 1
                began = time.monotonic()
                data = await fetch_piece(client, link, start, end)
                took = time.monotonic() - began
                digest = hashlib.sha256(data).hexdigest()
                say(f"    bajado  #{index + 1}: {human(len(data))} en {took:.1f}s ({speed(len(data), took)}) t={time.monotonic() - t0:.1f}s")
                await queue.put((index, data, digest, took))
            await queue.put(None)

        async def consumer() -> None:
            while True:
                item = await queue.get()
                if item is None:
                    return
                index, data, digest, down_took = item
                began = time.monotonic()
                try:
                    result = await upload_piece(client, user, f"probe.part{index + 1:04d}", data)
                except (ProviderFailure, RuntimeError, httpx.HTTPError) as exc:
                    say(f"    SUBIDA FALLÓ #{index + 1}: {type(exc).__name__} {getattr(exc, 'message', '')}")
                    records.append({"index": index, "ok": False})
                    continue
                took = time.monotonic() - began
                say(f"    subido  #{index + 1}: {human(len(data))} en {took:.1f}s ({speed(len(data), took)}) hash={result.get('hash')} t={time.monotonic() - t0:.1f}s")
                records.append({
                    "index": index, "ok": True, "hash": result.get("hash"), "url": result.get("url") or f"https://vikingfile.com/f/{result.get('hash')}",
                    "sha": digest, "size": len(data), "down": down_took, "up": took, "ready_at": time.monotonic() - t0,
                })

        try:
            await asyncio.gather(producer(), consumer())
        except (RuntimeError, httpx.HTTPError) as exc:
            say(f"    ERROR en el pipeline: {type(exc).__name__}: {str(exc)[:120]}")

        done = [r for r in records if r.get("ok")]
        wall = time.monotonic() - t0
        if done:
            sequential = sum(r["down"] + r["up"] for r in done)
            moved = sum(r["size"] for r in done)
            say(f"\n    Primer pedazo listo para el cliente a los {done[0]['ready_at']:.1f}s")
            say(f"    Total {human(moved)} en {wall:.1f}s ({speed(moved, wall)}); secuencial habría sido ~{sequential:.1f}s")

        say("\n[3] ¿Links directos o página?")
        kinds = []
        for record in done:
            try:
                kinds.append(await check_viking_link(client, record["url"]))
            except httpx.HTTPError as exc:
                say(f"    {record['url']}: error {type(exc).__name__}")
                kinds.append("unknown")

        say("\n[4] Verificación de integridad (bajando de ViKiNG)")
        for record, kind in zip(done, kinds):
            if kind != "direct":
                say(f"    #{record['index'] + 1}: omitido (no es link directo)")
                continue
            try:
                digest, size, took = await download_hash(client, record["url"])
            except httpx.HTTPError as exc:
                say(f"    #{record['index'] + 1}: error {type(exc).__name__}")
                continue
            verdict = "COINCIDE" if digest == record["sha"] and size == record["size"] else "NO COINCIDE"
            say(f"    #{record['index'] + 1}: {human(size)} en {took:.1f}s ({speed(size, took)}) sha256 {verdict}")

        if args.cleanup and user:
            for record in done:
                await client.post(VIKING_API_BASE + "/delete-file", data={"hash": record["hash"], "user": user}, timeout=20.0)
            say("\nPedazos de prueba borrados de ViKiNG.")
        elif done:
            say("\nPedazos de prueba siguen en tu cuenta de ViKiNG (usá --cleanup para borrarlos): " + ", ".join(r["hash"] for r in done))


if __name__ == "__main__":
    asyncio.run(main())
