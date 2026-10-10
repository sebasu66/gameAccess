"""Real local peer transfer: metadata, magnet parsing and bytes without public trackers."""
import threading
import time
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import libtorrent as lt
import digital_downloader as downloader


def test_magnet_transfers_fixture_from_local_peer(tmp_path, monkeypatch):
    seed_dir = tmp_path / "seed"
    output_dir = tmp_path / "download"
    seed_dir.mkdir()
    output_dir.mkdir()
    payload = b"GameAccess local torrent fixture\n" * 8192
    (seed_dir / "fixture.bin").write_bytes(payload)
    files = lt.file_storage()
    files.add_file("fixture.bin", len(payload))
    torrent = lt.create_torrent(files, 16384, lt.create_torrent.v1_only)
    torrent.set_priv(True)
    lt.set_piece_hashes(torrent, str(seed_dir))
    info = lt.torrent_info(lt.bencode(torrent.generate()))
    create_session = lt.session
    settings = {"listen_interfaces": "127.0.0.1:0", "enable_dht": False,
                "enable_lsd": False, "enable_upnp": False, "enable_natpmp": False}
    seed = create_session(settings)
    seed_params = lt.add_torrent_params()
    seed_params.ti = info
    seed_params.save_path = str(seed_dir)
    seed_params.flags &= ~(lt.torrent_flags.paused | lt.torrent_flags.auto_managed)
    seed_handle = seed.add_torrent(seed_params)
    deadline = time.monotonic() + 15
    while not seed_handle.status().is_seeding:
        assert time.monotonic() < deadline, "Local seed did not become ready"
        time.sleep(0.05)
    peer_port = seed.listen_port()

    class LocalSession:
        def __init__(self, ignored_settings):
            self.session = create_session(settings)
        def add_dht_node(self, ignored_node):
            pass
        def add_torrent(self, params):
            params.trackers = []
            params.flags &= ~(lt.torrent_flags.paused | lt.torrent_flags.auto_managed)
            handle = self.session.add_torrent(params)
            handle.connect_peer(("127.0.0.1", peer_port))
            return handle
        def pop_alerts(self):
            return self.session.pop_alerts()
        def remove_torrent(self, handle):
            self.session.remove_torrent(handle)

    monkeypatch.setattr(lt, "session", LocalSession)
    monkeypatch.setattr(downloader, "g_cancelled", threading.Event())
    monkeypatch.setattr(downloader, "g_paused", threading.Event())
    monkeypatch.setattr(downloader, "g_temp_files", [])
    monkeypatch.setattr(downloader, "emit_progress", lambda *args, **kwargs: None)
    magnet = downloader.normalize_download_source(lt.make_magnet_uri(info))
    result = downloader.download_direct_torrent(magnet, str(output_dir), "987654322", "Local fixture")
    assert Path(result).read_bytes() == payload
    seed.remove_torrent(seed_handle)
