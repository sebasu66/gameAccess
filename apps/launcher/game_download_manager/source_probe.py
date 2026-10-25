"""How healthy a download source is, checked locally before trying it (the app's "try another source").

A torrent (magnet, .torrent link or file) is added to a throw-away libtorrent session in upload-only mode, so it
never downloads the game: it only asks the trackers and the DHT how many seeds and peers it has, for a few seconds.
A direct link is checked with a HEAD request. Nothing is kept on disk afterwards.
"""
from __future__ import annotations

import shutil
import tempfile
import time
from pathlib import Path

import requests

TRACKERS = (
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
)
DHT_NODES = (("router.bittorrent.com", 6881), ("dht.transmissionbt.com", 6881), ("router.utorrent.com", 6881), ("dht.libtorrent.org", 25401))
ENOUGH_SEEDS = 8


def is_torrent(source: str) -> bool:
    lowered = source.lower()
    return lowered.startswith("magnet:?") or lowered.split("?", 1)[0].endswith(".torrent") or Path(source).suffix.lower() == ".torrent"


def probe_direct(source: str, head=requests.head) -> dict:
    try:
        response = head(source, allow_redirects=True, timeout=15)
        return {"kind": "direct", "reachable": response.status_code < 400, "seeds": 0, "peers": 0}
    except requests.RequestException:
        return {"kind": "direct", "reachable": False, "seeds": 0, "peers": 0}


def probe_torrent(source: str, timeout: float = 25.0, lt=None, clock=time.monotonic, sleep=time.sleep, get=requests.get) -> dict:
    if lt is None:
        import libtorrent as lt  # noqa: PLC0415 - only needed when a torrent is checked
    folder = Path(tempfile.mkdtemp(prefix="ga-probe-"))
    session = None
    try:
        session = lt.session({"listen_interfaces": "0.0.0.0:0,[::]:0", "enable_dht": True, "enable_lsd": True, "enable_upnp": False, "enable_natpmp": False})
        for node in DHT_NODES:
            session.add_dht_node(node)
        if source.startswith("magnet:?"):
            params = lt.parse_magnet_uri(source)
        else:
            path = Path(source)
            if not path.is_file():
                path = folder / "source.torrent"
                response = get(source, timeout=20)
                response.raise_for_status()
                path.write_bytes(response.content)
            params = lt.add_torrent_params()
            params.ti = lt.torrent_info(str(path))
        params.save_path = str(folder)
        params.trackers = list({*getattr(params, "trackers", []), *TRACKERS})
        # Upload-only: the torrent asks for peers but never downloads the game.
        params.flags |= lt.torrent_flags.upload_mode
        handle = session.add_torrent(params)
        seeds = peers = 0
        metadata = False
        started = clock()
        while clock() - started < timeout:
            status = handle.status()
            metadata = metadata or bool(status.has_metadata)
            seeds = max(seeds, int(getattr(status, "num_seeds", 0) or 0), int(getattr(status, "list_seeds", 0) or 0))
            peers = max(peers, int(getattr(status, "num_peers", 0) or 0), int(getattr(status, "list_peers", 0) or 0))
            if metadata and seeds >= ENOUGH_SEEDS:
                break
            sleep(1)
        return {"kind": "torrent", "reachable": metadata or seeds > 0, "seeds": seeds, "peers": peers, "metadata": metadata}
    except Exception as error:  # a broken magnet, a dead .torrent link or a missing libtorrent: this source cannot be used
        return {"kind": "torrent", "reachable": False, "seeds": 0, "peers": 0, "error": str(error)}
    finally:
        if session is not None:
            try:
                for handle in session.get_torrents():
                    session.remove_torrent(handle)
            except Exception:
                pass
        shutil.rmtree(folder, ignore_errors=True)


def probe_source(source: str, **kwargs) -> dict:
    source = (source or "").strip()
    if not source:
        return {"kind": "none", "reachable": False, "seeds": 0, "peers": 0}
    return probe_torrent(source, **kwargs) if is_torrent(source) else probe_direct(source)
