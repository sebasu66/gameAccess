import json
import time

from app.steam_catalog import SteamCatalogAdapter


def test_preserves_hls_trailers(tmp_path):
    adapter = SteamCatalogAdapter(tmp_path)
    url = "https://video.akamai.steamstatic.com/store_trailers/42/trailer.m3u8"
    result = adapter._normalize(42, {"movies": [{"id": 1, "hls_h264": url, "highlight": True}]})
    assert result["movies"][0]["hls_h264"] == url
    adapter._write_cache(42, "spanish", "ar", result)
    assert adapter._read_cache(42, "spanish", "ar") == result


def test_refreshes_cache_that_discarded_hls_links(tmp_path):
    adapter = SteamCatalogAdapter(tmp_path)
    old = {"movies": [{"id": 1, "mp4": None, "webm": None}]}
    adapter._cache_path(42, "spanish", "ar").write_text(json.dumps({"cached_at": time.time(), "data": old}))
    assert adapter._read_cache(42, "spanish", "ar") is None
    assert adapter._read_cache(42, "spanish", "ar", allow_stale=True) == old
