import asyncio

import httpx

from app import viking_cache_service as service

HASH = "a" * 40


def run(coro):
    return asyncio.run(coro)


def provider(handler, **kwargs):
    return service.TorBoxVikingProvider(
        torbox_api_key="key", viking_user_hash="user", transport=httpx.MockTransport(handler), **kwargs
    )


def public(monkeypatch):
    async def ok(host):
        return None
    monkeypatch.setattr(service, "_assert_public_host", ok)


def test_magnet_infohash_accepts_hex_and_base32():
    assert service.magnet_infohash(f"magnet:?xt=urn:btih:{HASH.upper()}&dn=x") == HASH
    assert service.magnet_infohash("magnet:?xt=urn:btih:" + "A" * 32) == "00" * 20
    assert service.magnet_infohash("https://host/file.zip") is None
    assert service.magnet_infohash("magnet:?dn=sin-hash") is None


def test_fast_direct_link_is_returned_as_is(monkeypatch):
    public(monkeypatch)
    handler = lambda request: httpx.Response(206, content=b"x" * (2 * 1024 * 1024))
    decision = run(provider(handler, direct_min_mbps=1).decide_delivery(source_url="https://cdn.example/f.zip", source_kind="direct"))
    assert decision.use_direct and decision.reason == "fast_direct" and decision.speed_bps > 0


def test_slow_threshold_sends_the_link_through_torbox(monkeypatch):
    public(monkeypatch)
    handler = lambda request: httpx.Response(206, content=b"x" * (2 * 1024 * 1024))
    decision = run(provider(handler, direct_min_mbps=1_000_000).decide_delivery(source_url="https://cdn.example/f.zip", source_kind="direct"))
    assert not decision.use_direct and decision.reason == "slow_or_unmeasurable"


def test_redirects_are_followed_and_error_pages_are_not_measured(monkeypatch):
    public(monkeypatch)

    def redirecting(request):
        if request.url.path == "/start":
            return httpx.Response(302, headers={"location": "https://cdn.example/real"})
        return httpx.Response(206, content=b"x" * (1024 * 1024))
    assert run(provider(redirecting).probe_direct_speed("https://host.example/start")) is not None

    not_found = lambda request: httpx.Response(404, content=b"no")
    assert run(provider(not_found).probe_direct_speed("https://host.example/f")) is None


def test_private_hosts_are_refused_and_never_raise(monkeypatch):
    async def private(host):
        raise ValueError("privada")
    monkeypatch.setattr(service, "_assert_public_host", private)
    decision = run(provider(lambda r: httpx.Response(200)).decide_delivery(source_url="https://intranet.example/f", source_kind="direct"))
    assert not decision.use_direct and decision.reason == "analysis_failed"


def test_torrent_cached_in_torbox_is_reported(monkeypatch):
    handler = lambda request: httpx.Response(200, json={"success": True, "data": {HASH: {"name": "x"}}})
    decision = run(provider(handler).decide_delivery(source_url=f"magnet:?xt=urn:btih:{HASH}", source_kind="torrent"))
    assert not decision.use_direct and decision.reason == "cached_in_torbox"

    empty = lambda request: httpx.Response(200, json={"success": True, "data": {}})
    decision = run(provider(empty).decide_delivery(source_url=f"magnet:?xt=urn:btih:{HASH}", source_kind="torrent"))
    assert decision.reason == "torrent_needs_torbox"


def test_web_pages_are_not_treated_as_fast_direct_downloads(monkeypatch):
    public(monkeypatch)
    page = lambda request: httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, content=b"<html>" + b"x" * (2 * 1024 * 1024))
    decision = run(provider(page, direct_min_mbps=1).decide_delivery(source_url="https://filehost.example/abc", source_kind="direct"))
    assert not decision.use_direct and decision.reason == "web_page"


def test_viking_upload_server_accepts_regional_hosts_only():
    assert service.is_viking_upload_server("https://jp.vikingfile.com/index2.php")
    assert service.is_viking_upload_server("https://upload.vikingfile.com/")
    assert not service.is_viking_upload_server("http://jp.vikingfile.com/index2.php")
    assert not service.is_viking_upload_server("https://vikingfile.com.evil.example/x")
    assert not service.is_viking_upload_server("https://evilvikingfile.com/x")
    assert not service.is_viking_upload_server("")


def test_viking_upload_reads_the_last_json_line_of_a_progress_stream():
    body = (
        '{"progress":"30.9%","current":4098,"total":13264,"name":"dummy.pdf"}\n'
        '{"progress":"100%","current":13264,"total":13264,"name":"dummy.pdf"}\n'
        '{"name":"ga-probe.pdf","size":"13264","hash":"wpGNXAgg1"}'
    )
    parsed = service.parse_viking_upload_response(httpx.Response(200, text=body))
    assert parsed["hash"] == "wpGNXAgg1" and parsed["size"] == "13264"


def test_viking_upload_error_line_and_bad_bodies_fail_clearly():
    import pytest
    with pytest.raises(service.ProviderFailure) as rejected:
        service.parse_viking_upload_response(httpx.Response(200, text='{"progress":"10%"}\n{"error":"link not allowed"}'))
    assert "link not allowed" in rejected.value.public_message
    with pytest.raises(service.ProviderFailure):
        service.parse_viking_upload_response(httpx.Response(200, text="<html>nope</html>"))
    with pytest.raises(service.ProviderFailure):
        service.parse_viking_upload_response(httpx.Response(500, text="{}"))


def test_viking_plain_text_refusal_gets_its_own_message():
    import pytest
    with pytest.raises(service.ProviderFailure) as refused:
        service.parse_viking_upload_response(httpx.Response(200, text="can not download link"))
    assert refused.value.code == "viking_cannot_fetch_link"


def test_check_file_accepts_the_list_answer_viking_sends_now():
    def handler(request):
        return httpx.Response(200, json=[{"exist": True, "hash": "abc", "name": "x.rar", "size": 5}])
    assert run(provider(handler).check_viking_file("abc")) is True


def test_check_file_accepts_the_single_object_answer_and_reports_missing_files():
    def present(request):
        return httpx.Response(200, json={"exist": True})
    def missing(request):
        return httpx.Response(200, json=[{"exist": False, "hash": "abc"}])
    assert run(provider(present).check_viking_file("abc")) is True
    assert run(provider(missing).check_viking_file("abc")) is False


def test_requestdl_retries_a_torbox_500_and_then_succeeds(monkeypatch):
    calls = {"requestdl": 0}

    def handler(request):
        path = request.url.path
        if path.endswith("/torrents/createtorrent"):
            return httpx.Response(200, json={"success": True, "data": {"torrent_id": 7}})
        if path.endswith("/torrents/mylist"):
            return httpx.Response(200, json={"data": {"id": 7, "download_finished": True, "size": 10}})
        if path.endswith("/torrents/requestdl"):
            calls["requestdl"] += 1
            if calls["requestdl"] < 3:
                return httpx.Response(500, json={"detail": "zip failed"})
            return httpx.Response(200, json={"success": True, "data": "https://cdn.example/file.zip"})
        if path.endswith("/get-server"):
            return httpx.Response(200, json={"server": "https://upload.vikingfile.com"})
        if request.url.host.endswith("vikingfile.com"):
            return httpx.Response(200, text='{"name":"g.zip","size":10,"hash":"HASH123456","url":"https://vikingfile.com/f/HASH123456"}')
        return httpx.Response(404)

    sleeps = []

    async def no_wait(seconds):
        sleeps.append(seconds)

    result = run(provider(handler, sleep_fn=no_wait).process_source(
        source_url="magnet:?xt=urn:btih:" + HASH, source_kind="torrent", source_host="magnet",
        item_name="Game", file_name="", request_id="r", installation_id="i", fingerprint="f" * 64,
    ))
    assert calls["requestdl"] == 3
    assert result.file_hash == "HASH123456"
    assert [s for s in sleeps if s >= 4] == [4.0, 8.0]


def test_requestdl_gives_up_after_three_torbox_500s():
    def handler(request):
        path = request.url.path
        if path.endswith("/torrents/createtorrent"):
            return httpx.Response(200, json={"success": True, "data": {"torrent_id": 7}})
        if path.endswith("/torrents/mylist"):
            return httpx.Response(200, json={"data": {"id": 7, "download_finished": True, "size": 10}})
        return httpx.Response(500, json={})

    async def no_wait(seconds):
        return None

    try:
        run(provider(handler, sleep_fn=no_wait).process_source(
            source_url="magnet:?xt=urn:btih:" + HASH, source_kind="torrent", source_host="magnet",
            item_name="Game", file_name="", request_id="r", installation_id="i", fingerprint="f" * 64,
        ))
    except service.ProviderFailure as exc:
        assert exc.code == "torbox_server_error"
    else:
        raise AssertionError("expected a ProviderFailure")
