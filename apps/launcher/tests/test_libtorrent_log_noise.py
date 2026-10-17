"""libtorrent error alerts that only mean a peer hung up or the router lacks UPnP stay out of the log."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_download_manager.torrent_transport import is_libtorrent_noise


def test_peer_resets_and_missing_upnp_router_are_noise():
    assert is_libtorrent_noise(
        "UDP error: Se ha forzado la interrupción de una conexión existente por el host remoto from: 2803::1 op: sock_read"
    )
    assert is_libtorrent_noise("could not map port using UPnP[192.168.56.1]: no router found")


def test_real_failures_are_not_hidden():
    assert not is_libtorrent_noise("torrent error: disk full")
    assert not is_libtorrent_noise("file error (write): No space left on device")
