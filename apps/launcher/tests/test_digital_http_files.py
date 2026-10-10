"""Regression: landing pages cannot complete as games; valid ranges still work."""
import functools
import http.server
import threading
from pathlib import Path
from unittest.mock import patch
import pytest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import digital_downloader as downloader
from digital_storage import DigitalGameStorage

class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def respond(self, head=False):
        body = b"<!DOCTYPE html><html>Download page</html>" if self.path not in ("/fixture.zip", "/head-html.zip", "/head-405.zip") else b"PK\x03\x04fixture" * 100
        content_type = "text/html" if self.path == "/html" else "application/octet-stream"
        start, end = 0, len(body) - 1
        requested = self.headers.get("Range")
        if requested and self.path != "/ignores-range":
            start, end = map(int, requested.replace("bytes=", "").split("-"))
            end = min(end, len(body) - 1)
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(body)}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        if not head:
            self.wfile.write(body[start:end+1])
    def do_HEAD(self):
        if self.path == "/head-405.zip":
            self.send_error(405)
        elif self.path == "/head-html.zip":
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
        else:
            self.respond(True)
    def do_GET(self):
        self.respond()

@pytest.fixture
def server():
    instance = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    thread = threading.Thread(target=instance.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{instance.server_port}"
    instance.shutdown()
    instance.server_close()

@pytest.mark.parametrize("path", ["/html", "/disguised-html"])
def test_html_rejected_before_output_is_created(server, tmp_path, path):
    output = tmp_path / "download.bin"
    with patch.object(downloader, "emit_progress"):
        with pytest.raises(RuntimeError, match="página web|HTML"):
            downloader.download_segmented(server + path, str(output), "7", "Fixture", connections=2)
    assert not output.exists()

def test_binary_segmented_transfer_preserves_bytes(server, tmp_path):
    output = tmp_path / "fixture.zip"
    with patch.object(downloader, "emit_progress"):
        assert downloader.download_segmented(server + "/fixture.zip", str(output), "7", "Fixture", connections=2)
    assert output.read_bytes() == b"PK\x03\x04fixture" * 100

def test_existing_landing_page_is_not_installed(tmp_path):
    storage = DigitalGameStorage(tmp_path)
    folder = storage.register(7, "Fixture")
    (folder / "ABC").write_bytes(b"<!DOCTYPE html><html>page</html>")
    assert not storage.status(7, "Fixture")["installed"]
    (folder / "game.exe").write_bytes(b"MZfixture")
    assert storage.status(7, "Fixture")["installed"]

def test_final_payload_validation_catches_empty_or_html(tmp_path):
    output = tmp_path / "payload"
    for body in (b"", b" \r\n<!DOCTYPE html><html>page</html>"):
        output.write_bytes(body)
        with pytest.raises(RuntimeError):
            downloader.validate_downloaded_file(str(output))

@pytest.mark.parametrize("path", ["/head-html.zip", "/head-405.zip"])
def test_get_file_works_when_head_is_html_or_unsupported(server, tmp_path, path):
    output = tmp_path / "fixture.zip"
    with patch.object(downloader, "emit_progress"):
        assert downloader.download_segmented(server + path, str(output), "7", "Fixture", connections=2)
    assert output.read_bytes() == b"PK\x03\x04fixture" * 100

@pytest.mark.parametrize("topic", ["urn:btih:" + "a" * 40, "urn:btih:" + "M" * 32, "urn:btmh:1220" + "b" * 64])
def test_valid_magnets_are_normalized_and_use_torrent_engine(topic):
    source = downloader.normalize_download_source(" MAGNET:?xt=" + topic + "&amp;dn=Fixture ")
    assert source.startswith("magnet:?")
    assert "&amp;" not in source
    assert downloader.is_torrent_source(source)
    import libtorrent as lt
    params = lt.parse_magnet_uri(source)
    assert params.info_hashes.has_v1() or params.info_hashes.has_v2()

@pytest.mark.parametrize("source", ["magnet:?dn=missing", "magnet:?xt=urn:btih:bad", "javascript:bad"])
def test_invalid_sources_rejected_before_network(source):
    with pytest.raises(ValueError):
        downloader.normalize_download_source(source)

def test_torrent_word_in_provider_host_does_not_change_http_transport():
    assert not downloader.is_torrent_source("https://torrent-provider.test/api/download/fixture.zip")
    assert downloader.is_torrent_source("https://example.test/fixture.torrent?token=123")
