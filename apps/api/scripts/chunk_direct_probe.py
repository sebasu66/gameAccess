"""End-to-end probe: TorBox Range pieces -> ViKiNG upload -> direct CDN link -> download + sha256.

Reuses chunk_relay_probe (same folder) and the provider's resolve_viking_direct_link.
Prints hosts only; no cookies, tokens or signed query strings are shown.
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

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import chunk_relay_probe as base  # noqa: E402
from app.viking_cache_service import ProviderFailure, create_provider  # noqa: E402

MB = base.MB
say = base.say


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--id", type=int, default=118223415)  # Portal 2 in TorBox
    parser.add_argument("--chunk-mb", type=int, default=100)
    parser.add_argument("--chunks", type=int, default=3)
    parser.add_argument("--keep", action="store_true", help="do not delete the test pieces")
    args = parser.parse_args()

    env = base.load_env()
    token, user = env.get("TORBOX_API_KEY", ""), env.get("VIKING_USER_HASH", "")
    provider = create_provider()
    say(f"sesion premium configurada: {'si' if provider._viking_cookie_header() else 'NO'}")

    async with httpx.AsyncClient() as client:
        torbox = base.Torbox(token, client)
        items = [i for i in await torbox.mylist("torrent") if i.get("id") == args.id]
        files = (items[0].get("files") if items else None) or []
        biggest = max(files, key=lambda f: f.get("size") or 0)
        link = await torbox.link("torrent", args.id, biggest.get("id"), False)
        total = await base.probe_range(client, link)
        if total is None:
            return
        piece = args.chunk_mb * MB
        count = max(1, min(args.chunks, math.ceil(total / piece)))
        say(f"\nProbando {count} pedazos de {args.chunk_mb} MB de {str(biggest.get('name'))[-40:]}")

        uploaded: list[dict] = []
        t0 = time.monotonic()
        for index in range(count):
            start = index * piece
            end = min(start + piece, total) - 1
            data = await base.fetch_piece(client, link, start, end)
            sha = hashlib.sha256(data).hexdigest()
            began = time.monotonic()
            result = await base.upload_piece(client, user, f"direct_probe.part{index + 1:04d}", data)
            up_took = time.monotonic() - began
            file_hash = result.get("hash")
            record = {"index": index, "hash": file_hash, "sha": sha, "size": len(data)}
            say(f"\n#{index + 1} subido {base.human(len(data))} en {up_took:.1f}s hash={file_hash}")
            uploaded.append(record)

            began = time.monotonic()
            try:
                direct = await provider.resolve_viking_direct_link(file_hash)
            except ProviderFailure as exc:
                say(f"   RESOLVER FALLO: {exc.code} - {exc.public_message}")
                record["direct"] = None
                continue
            res_took = time.monotonic() - began
            parsed = urlsplit(direct)
            record["direct"] = direct
            say(f"   link directo en {res_took:.1f}s -> host={parsed.hostname} path={parsed.path[:40]} (firma oculta)")
            say(f"   listo para el cliente a los {time.monotonic() - t0:.1f}s desde el inicio")

            async with client.stream("GET", direct, headers={"Range": "bytes=0-1023"}, follow_redirects=True, timeout=60) as r:
                say(f"   Range: status={r.status_code} content-range={r.headers.get('content-range')} tipo={r.headers.get('content-type')}")
                if "text/html" in r.headers.get("content-type", "").lower():
                    say("   ES UNA PAGINA, no el archivo")
                    record["direct"] = None
                    continue
            digest, size, took = await base.download_hash(client, direct)
            ok = digest == sha and size == len(data)
            say(f"   bajado {base.human(size)} en {took:.1f}s ({base.speed(size, took)}) sha256 {'COINCIDE' if ok else 'NO COINCIDE'}")
            record["ok"] = ok

        good = [r for r in uploaded if r.get("ok")]
        say(f"\nRESUMEN: {len(good)}/{count} pedazos subidos, resueltos y verificados")
        if not args.keep and user:
            for r in uploaded:
                await client.post(base.VIKING_API_BASE + "/delete-file", data={"hash": r["hash"], "user": user}, timeout=20.0)
            say("Pedazos de prueba borrados de ViKiNG.")


if __name__ == "__main__":
    asyncio.run(main())
