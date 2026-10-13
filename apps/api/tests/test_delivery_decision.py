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
