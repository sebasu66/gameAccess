import pytest
import httpx
from app.viking_cache_service import TorBoxVikingProvider, ProviderFailure


@pytest.mark.anyio
async def test_resolve_viking_direct_link_follows_redirects():
    # Mocking two 302 redirects:
    # 1. /f/7QiNDECLPN -> /d/abc/game.rar (sets new PHPSESSID)
    # 2. /d/abc/game.rar -> https://cx.vikingfile.com/download/xyz/game.rar?md5=sig&expires=123
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if url == "https://vikingfile.com/f/7QiNDECLPN":
            assert "REMEMBERME=token123" in request.headers.get("cookie", "")
            return httpx.Response(
                302,
                headers={
                    "Location": "/d/abc/game.rar",
                    "Set-Cookie": "PHPSESSID=session456; path=/",
                },
            )
        elif url == "https://vikingfile.com/d/abc/game.rar":
            assert "REMEMBERME=token123" in request.headers.get("cookie", "")
            assert "PHPSESSID=session456" in request.headers.get("cookie", "")
            return httpx.Response(
                302,
                headers={
                    "Location": "https://cx.vikingfile.com/download/xyz/game.rar?md5=sig&expires=123",
                },
            )
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    provider = TorBoxVikingProvider(
        viking_rememberme="token123",
        transport=transport,
    )

    direct_url = await provider.resolve_viking_direct_link("7QiNDECLPN")
    assert direct_url == "https://cx.vikingfile.com/download/xyz/game.rar?md5=sig&expires=123"


@pytest.mark.anyio
async def test_resolve_viking_direct_link_detects_captcha_block():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            text="<html><script src='https://challenges.cloudflare.com/turnstile/v0/api.js'></script></html>",
        )

    transport = httpx.MockTransport(handler)
    provider = TorBoxVikingProvider(
        viking_rememberme="token123",
        transport=transport,
    )

    with pytest.raises(ProviderFailure) as exc_info:
        await provider.resolve_viking_direct_link("7QiNDECLPN")
    assert exc_info.value.code == "viking_auth_required"


@pytest.mark.anyio
async def test_resolve_viking_direct_link_returns_landing_if_no_cookie():
    provider = TorBoxVikingProvider(
        viking_rememberme="",
        viking_cookie="",
    )
    # Sin cookie configurada, debe retornar la URL base sin romper
    url = await provider.resolve_viking_direct_link("7QiNDECLPN")
    assert url == "https://vikingfile.com/f/7QiNDECLPN"
